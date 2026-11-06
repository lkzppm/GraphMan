//! `graphman dblp`: the DBLP XML dump turned into the course's collaboration
//! network, `rede_colaboracao.txt` (a weighted edge list) and
//! `rede_colaboracao_vertices.txt` (the researchers' names), whole and as it
//! stood at the end of chosen years.
//!
//! The dump (<https://dblp.org/xml/>, about 1.1 GB gzipped; every month a
//! snapshot gets a DOI on DROPS) is one XML document with a record per
//! publication. It is read as a stream: only the authors' names and the
//! co-author pairs stay in memory, so the whole thing takes minutes and a
//! few GB. Every record except the author pages (`www`, `person`) is a
//! paper; its `<author>` elements name its authors and its `<year>` dates
//! it. The XML is Latin-1 (transcoded to UTF-8 on the way in), with the
//! HTML entities of the DTD for accents (`&eacute;`) and numeric references
//! for everything else; both are decoded here, the DTD's entity table being
//! built in.

use crate::ui::{self, Ui};
use anyhow::{Context, Result, ensure};
use flate2::Compression;
use flate2::read::MultiGzDecoder;
use flate2::write::GzEncoder;
use graphman::io::{Network, Papers, YEAR_UNKNOWN};
use quick_xml::escape::resolve_xml_entity;
use quick_xml::events::{BytesRef, BytesStart, Event};
use quick_xml::reader::Reader;
use serde::Serialize;
use std::collections::BTreeMap;
use std::collections::btree_map::Entry;
use std::fs::File;
use std::io::{self, BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[derive(clap::Args)]
pub struct Args {
    /// The dump, `dblp.xml` or `dblp.xml.gz` (https://dblp.org/xml/).
    dump: PathBuf,

    /// Directory for the output files.
    #[arg(short, long, default_value = ".")]
    out: PathBuf,

    /// Base name of the files: `<name>.txt`, `<name>_vertices.txt`, and
    /// `<name>_<year>.txt`, `<name>_<year>_vertices.txt` per year.
    #[arg(long, default_value = "rede_colaboracao")]
    name: String,

    /// Also write the network as it stood at the end of these years
    /// (comma-separated, e.g. `2009,2020`); the course's file covers the
    /// network up to 2009, under an older weight rule.
    #[arg(long, value_delimiter = ',')]
    years: Vec<u16>,

    /// Count formal publications only: skip DBLP's informal ones (arXiv
    /// preprints and the like, `publtype="informal"`), which otherwise count
    /// a paper and its preprint as two.
    #[arg(long)]
    formal_only: bool,

    /// Write gzip-compressed files (`.txt.gz`).
    #[arg(long)]
    gzip: bool,

    /// Where the dump came from (a URL or DOI), recorded in the manifest.
    #[arg(long)]
    source: Option<String>,

    /// The dump's release date (`YYYY-MM-DD`), recorded in the manifest.
    #[arg(long)]
    date: Option<String>,

    /// Also lay the network out by year in this directory, for the site:
    /// per year, the papers every pair shared that year and the
    /// researchers first seen that year, plus a manifest. The page sums the
    /// years up to the one chosen, so any year can be picked.
    #[arg(long)]
    site: Option<PathBuf>,
}

/// The rule the weights follow, spelled out once for the manifest.
const WEIGHT_RULE: &str = "1 / number of shared papers";

const MB: u64 = 1_000_000;

pub fn run(args: Args, ui: &Ui) -> Result<()> {
    ui.title("dblp");
    let mut years = args.years.clone();
    years.sort_unstable();
    years.dedup();
    ensure!(
        years.iter().all(|&year| year < YEAR_UNKNOWN),
        "a year must be below {YEAR_UNKNOWN}"
    );
    std::fs::create_dir_all(&args.out)
        .with_context(|| format!("creating {}", args.out.display()))?;

    let mut file =
        File::open(&args.dump).with_context(|| format!("opening {}", args.dump.display()))?;
    let len = file.metadata()?.len();
    let gzipped = is_gzip(&mut file)?;
    let read = Arc::new(AtomicU64::new(0));
    let counting = CountingRead {
        inner: file,
        read: Arc::clone(&read),
    };
    let input: Box<dyn Read> = if gzipped {
        Box::new(MultiGzDecoder::new(counting))
    } else {
        Box::new(counting)
    };

    let started = Instant::now();
    ui.step(&format!(
        "reading {}{}",
        args.dump.display(),
        if gzipped { " (gzip)" } else { "" }
    ));
    let bar = ui.progress(Some(len / MB), "dump, MB");
    let dump = read_dump(input, args.formal_only, &mut || {
        bar.set_position(read.load(Ordering::Relaxed) / MB);
    })?;
    bar.finish_and_clear();
    let reading = started.elapsed();
    ui.kv("records", dump.records);
    ui.kv("skipped", dump.skipped);
    ui.kv("papers", dump.papers.paper_count());
    ui.kv("researchers", dump.papers.author_count());
    ui.kv(
        "largest paper",
        format!("{} authors", dump.papers.largest_paper()),
    );
    ui.kv("read in", ui::duration(reading));
    if !dump.unknown_entities.is_empty() {
        ui.warn(&format!(
            "unknown entities kept as written: {}",
            dump.unknown_entities.join(", ")
        ));
    }

    ui.step("numbering the researchers");
    let network = dump.papers.finish();
    let edges = network.edge_count(None);
    ui.kv("collaborations", edges);
    if let Some((first, last)) = network.years() {
        ui.kv("years", format!("{first} to {last}"));
    }

    ui.step(&format!("writing to {}", args.out.display()));
    let mut tiers = Vec::with_capacity(years.len() + 1);
    for until in years.iter().map(|&year| Some(year)).chain([None]) {
        tiers.push(write_tier(&network, until, &args, ui)?);
    }
    let by_year = match &args.site {
        Some(dir) => {
            ui.step(&format!("laying out by year in {}", dir.display()));
            write_site(&network, dir, &args, ui)?
        }
        None => Vec::new(),
    };

    let built_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (first_year, last_year) = network
        .years()
        .map_or((None, None), |(a, b)| (Some(a), Some(b)));
    let manifest = Manifest {
        schema: 1,
        generator: format!("graphman {}", env!("CARGO_PKG_VERSION")),
        built_at,
        date: args.date.as_deref(),
        source: args.source.as_deref(),
        dump: file_name(&args.dump),
        formal_only: args.formal_only,
        weight: WEIGHT_RULE,
        records: dump.records,
        skipped: dump.skipped,
        papers: dump.papers_counted,
        authors: network.vertex_count(None),
        edges,
        first_year,
        last_year,
        tiers,
        years: Vec::new(),
    };
    let path = args.out.join("manifest.json");
    serde_json::to_writer_pretty(BufWriter::new(File::create(&path)?), &manifest)
        .with_context(|| format!("writing {}", path.display()))?;
    if let Some(dir) = &args.site {
        let site = Manifest {
            schema: 2,
            generator: manifest.generator.clone(),
            dump: manifest.dump.clone(),
            tiers: Vec::new(),
            years: by_year,
            ..manifest
        };
        let path = dir.join("manifest.json");
        serde_json::to_writer_pretty(BufWriter::new(File::create(&path)?), &site)
            .with_context(|| format!("writing {}", path.display()))?;
    }
    let path = args.out.join("README.md");
    std::fs::write(&path, readme(&manifest, &args))
        .with_context(|| format!("writing {}", path.display()))?;

    ui.done(&format!(
        "{} researchers, {} collaborations, in {}",
        network.vertex_count(None),
        edges,
        ui::duration(started.elapsed())
    ));
    Ok(())
}

// ---- reading the dump ------------------------------------------------------

/// What one pass over the dump gathered.
struct Dump {
    papers: Papers,
    /// Records of every kind, author pages included.
    records: usize,
    /// Records that are not papers (author pages) or were asked away
    /// (informal ones under `--formal-only`).
    skipped: usize,
    /// Papers that counted: two or more distinct authors.
    papers_counted: usize,
    /// Entity names the DTD does not define, kept as written (at most a few).
    unknown_entities: Vec<String>,
}

/// Which field of the current record is being read.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Field {
    None,
    Author,
    Year,
}

/// The record being read: its authors so far and its year.
#[derive(Default)]
struct Record {
    skip: bool,
    year: Option<u16>,
    authors: Vec<String>,
}

/// Streams the XML once, collecting every paper into `Papers`. `progress`
/// is called now and then so a bar can follow the bytes read underneath.
fn read_dump<R: Read>(input: R, formal_only: bool, progress: &mut dyn FnMut()) -> Result<Dump> {
    let input = Transcoded::new(input)?;
    let mut reader = Reader::from_reader(BufReader::with_capacity(1 << 20, input));
    // DBLP is well-formed; checking every closing tag's name would only
    // cost an allocation per element.
    reader.config_mut().check_end_names = false;
    let mut buf = Vec::with_capacity(4096);
    let mut dump = Dump {
        papers: Papers::new(),
        records: 0,
        skipped: 0,
        papers_counted: 0,
        unknown_entities: Vec::new(),
    };
    // Depth 1 is `<dblp>`, 2 a record, 3 one of its fields.
    let mut depth = 0usize;
    let mut record = Record::default();
    let mut field = Field::None;
    let mut text = String::new();
    let mut events = 0u64;
    loop {
        match reader.read_event_into(&mut buf) {
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("malformed XML at byte {}", reader.error_position()));
            }
            Ok(Event::Eof) => break,
            Ok(Event::Start(start)) => {
                depth += 1;
                match depth {
                    2 => {
                        record.skip = skips(&start, formal_only)?;
                        record.year = None;
                        record.authors.clear();
                    }
                    3 if !record.skip => {
                        field = match start.name().as_ref() {
                            "author" => Field::Author,
                            "year" => Field::Year,
                            _ => Field::None,
                        };
                        text.clear();
                    }
                    _ => {}
                }
            }
            Ok(Event::End(_)) => {
                match depth {
                    3 => {
                        match field {
                            Field::Author => record.authors.push(std::mem::take(&mut text)),
                            Field::Year => record.year = parse_year(&text),
                            Field::None => {}
                        }
                        field = Field::None;
                    }
                    2 => {
                        dump.records += 1;
                        if record.skip {
                            dump.skipped += 1;
                        } else if dump
                            .papers
                            .paper(record.year, record.authors.iter().map(String::as_str))
                        {
                            dump.papers_counted += 1;
                        }
                    }
                    _ => {}
                }
                depth = depth.saturating_sub(1);
            }
            Ok(Event::Text(piece)) if field != Field::None => text.push_str(&piece),
            Ok(Event::CData(piece)) if field != Field::None => text.push_str(&piece),
            Ok(Event::GeneralRef(reference)) if field != Field::None => {
                resolve(&reference, &mut text, &mut dump.unknown_entities)?;
            }
            Ok(_) => {}
        }
        buf.clear();
        events += 1;
        if events & 0xfff == 0 {
            progress();
        }
    }
    Ok(dump)
}

/// Whether a record is left out: author pages always, informal
/// publications when asked.
fn skips(start: &BytesStart, formal_only: bool) -> Result<bool> {
    if matches!(start.name().as_ref(), "www" | "person") {
        return Ok(true);
    }
    if !formal_only {
        return Ok(false);
    }
    let informal = start
        .try_get_attribute("publtype")?
        .is_some_and(|attribute| attribute.value.starts_with("informal"));
    Ok(informal)
}

/// A `&...;` reference: a character by number, one of XML's five, one of
/// the DTD's accents, or unknown and kept as written.
fn resolve(reference: &BytesRef, text: &mut String, unknown: &mut Vec<String>) -> Result<()> {
    if let Some(character) = reference.resolve_char_ref()? {
        text.push(character);
        return Ok(());
    }
    let name: &str = reference;
    match resolve_xml_entity(name).or_else(|| entity(name)) {
        Some(replacement) => text.push_str(replacement),
        None => {
            text.push('&');
            text.push_str(name);
            text.push(';');
            if unknown.len() < 20 && !unknown.iter().any(|known| known == name) {
                unknown.push(name.to_owned());
            }
        }
    }
    Ok(())
}

/// The first four digits of a `<year>`, if that is what it holds.
fn parse_year(text: &str) -> Option<u16> {
    let digits: String = text
        .trim()
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    if digits.len() == 4 {
        digits.parse().ok()
    } else {
        None
    }
}

/// The DTD's character entities (`dblp.dtd`: the HTML Latin-1 set plus
/// `reg`, `micro` and `times`), sorted by name.
fn entity(name: &str) -> Option<&'static str> {
    const ENTITIES: &[(&str, &str)] = &[
        ("AElig", "Æ"),
        ("Aacute", "Á"),
        ("Acirc", "Â"),
        ("Agrave", "À"),
        ("Aring", "Å"),
        ("Atilde", "Ã"),
        ("Auml", "Ä"),
        ("Ccedil", "Ç"),
        ("ETH", "Ð"),
        ("Eacute", "É"),
        ("Ecirc", "Ê"),
        ("Egrave", "È"),
        ("Euml", "Ë"),
        ("Iacute", "Í"),
        ("Icirc", "Î"),
        ("Igrave", "Ì"),
        ("Iuml", "Ï"),
        ("Ntilde", "Ñ"),
        ("Oacute", "Ó"),
        ("Ocirc", "Ô"),
        ("Ograve", "Ò"),
        ("Oslash", "Ø"),
        ("Otilde", "Õ"),
        ("Ouml", "Ö"),
        ("THORN", "Þ"),
        ("Uacute", "Ú"),
        ("Ucirc", "Û"),
        ("Ugrave", "Ù"),
        ("Uuml", "Ü"),
        ("Yacute", "Ý"),
        ("aacute", "á"),
        ("acirc", "â"),
        ("aelig", "æ"),
        ("agrave", "à"),
        ("aring", "å"),
        ("atilde", "ã"),
        ("auml", "ä"),
        ("ccedil", "ç"),
        ("eacute", "é"),
        ("ecirc", "ê"),
        ("egrave", "è"),
        ("eth", "ð"),
        ("euml", "ë"),
        ("iacute", "í"),
        ("icirc", "î"),
        ("igrave", "ì"),
        ("iuml", "ï"),
        ("micro", "µ"),
        ("ntilde", "ñ"),
        ("oacute", "ó"),
        ("ocirc", "ô"),
        ("ograve", "ò"),
        ("oslash", "ø"),
        ("otilde", "õ"),
        ("ouml", "ö"),
        ("reg", "®"),
        ("szlig", "ß"),
        ("thorn", "þ"),
        ("times", "×"),
        ("uacute", "ú"),
        ("ucirc", "û"),
        ("ugrave", "ù"),
        ("uuml", "ü"),
        ("yacute", "ý"),
        ("yuml", "ÿ"),
    ];
    ENTITIES
        .binary_search_by_key(&name, |&(key, _)| key)
        .ok()
        .map(|index| ENTITIES[index].1)
}

/// Reads the magic bytes and rewinds.
fn is_gzip(file: &mut File) -> io::Result<bool> {
    let mut magic = [0u8; 2];
    let read = file.read(&mut magic)?;
    file.seek(SeekFrom::Start(0))?;
    Ok(read == 2 && magic == [0x1f, 0x8b])
}

/// The dump transcoded to UTF-8 on the way in. DBLP declares ISO-8859-1
/// (in practice its text is ASCII with entities, but a raw accented byte
/// would be malformed UTF-8), so when the declaration names Latin-1 every
/// byte above 0x7F becomes its two-byte UTF-8 form; any other declaration,
/// or none, passes through as UTF-8.
struct Transcoded<R> {
    inner: R,
    latin1: bool,
    raw: Vec<u8>,
    out: Vec<u8>,
    pos: usize,
}

impl<R: Read> Transcoded<R> {
    fn new(mut inner: R) -> io::Result<Self> {
        // The declaration, if any, is in the first line.
        let mut head = vec![0u8; 256];
        let mut filled = 0;
        while filled < head.len() {
            let n = inner.read(&mut head[filled..])?;
            if n == 0 {
                break;
            }
            filled += n;
        }
        head.truncate(filled);
        let latin1 = declares_latin1(&head);
        let mut out = Vec::with_capacity(1 << 17);
        expand(&head, latin1, &mut out);
        Ok(Self {
            inner,
            latin1,
            raw: vec![0; 1 << 16],
            out,
            pos: 0,
        })
    }
}

impl<R: Read> Read for Transcoded<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.pos == self.out.len() {
            let n = self.inner.read(&mut self.raw)?;
            self.out.clear();
            self.pos = 0;
            expand(&self.raw[..n], self.latin1, &mut self.out);
            if self.out.is_empty() {
                return Ok(0);
            }
        }
        let n = buf.len().min(self.out.len() - self.pos);
        buf[..n].copy_from_slice(&self.out[self.pos..self.pos + n]);
        self.pos += n;
        Ok(n)
    }
}

/// Appends `bytes` to `out`, as they are or widened from Latin-1 to UTF-8.
fn expand(bytes: &[u8], latin1: bool, out: &mut Vec<u8>) {
    if !latin1 {
        out.extend_from_slice(bytes);
        return;
    }
    out.reserve(bytes.len() * 2);
    for &byte in bytes {
        if byte < 0x80 {
            out.push(byte);
        } else {
            out.push(0xC0 | (byte >> 6));
            out.push(0x80 | (byte & 0x3F));
        }
    }
}

/// Whether the XML declaration names a Latin-1 encoding.
fn declares_latin1(head: &[u8]) -> bool {
    let text = String::from_utf8_lossy(head).to_ascii_lowercase();
    let Some(start) = text.find("<?xml") else {
        return false;
    };
    let end = text[start..]
        .find("?>")
        .map_or(text.len(), |end| start + end);
    let declaration = &text[start..end];
    ["iso-8859-1", "latin1", "latin-1", "windows-1252", "cp1252"]
        .iter()
        .any(|label| {
            declaration.contains(&format!("encoding=\"{label}\""))
                || declaration.contains(&format!("encoding='{label}'"))
        })
}

/// A reader that counts what passes through, for the progress bar.
struct CountingRead<R> {
    inner: R,
    read: Arc<AtomicU64>,
}

impl<R: Read> Read for CountingRead<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.read.fetch_add(n as u64, Ordering::Relaxed);
        Ok(n)
    }
}

// ---- writing the files -----------------------------------------------------

/// One network written: whole (`year: None`) or up to a year.
#[derive(Serialize)]
struct Tier {
    year: Option<u16>,
    vertices: usize,
    edges: usize,
    graph: FileInfo,
    names: FileInfo,
}

/// A file written, with its size on disk and before compression.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileInfo {
    file: String,
    bytes: u64,
    raw_bytes: u64,
}

/// `manifest.json`: what was built, from what, and the files with their
/// sizes, for the site and for anyone scripting over the output.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Manifest<'a> {
    schema: u32,
    generator: String,
    /// Unix seconds.
    built_at: u64,
    date: Option<&'a str>,
    source: Option<&'a str>,
    dump: String,
    formal_only: bool,
    weight: &'static str,
    records: usize,
    /// Author pages, and informal publications when left out.
    skipped: usize,
    /// Records with two or more authors.
    papers: usize,
    authors: usize,
    edges: usize,
    first_year: Option<u16>,
    last_year: Option<u16>,
    /// The course-format files here (schema 1, the release).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tiers: Vec<Tier>,
    /// The network year by year (schema 2, the site).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    years: Vec<YearEntry>,
}

/// One year of the site layout: its two files, and the network up to it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct YearEntry {
    year: u16,
    /// The network up to and including this year.
    vertices: usize,
    edges: usize,
    /// Pairs that gained strength this year: the strengths file's lines.
    pairs: usize,
    strengths: FileInfo,
    names: FileInfo,
}

/// Writes the site layout into `dir`: for every year from the first to the
/// last with a paper, `strengths_<year>.txt` (`u v strength` per line: what
/// each pair gained that year, see `Network::strengths`) and
/// `names_<year>.txt` (`vertex,name` per line: the researchers whose first
/// collaboration was that year), so that the network up to a year is the
/// sum of the files up to it. Undated papers count in the last year, which
/// makes the last year the whole network. Every year's file stays open
/// through the one pass over the strengths.
fn write_site(network: &Network, dir: &Path, args: &Args, ui: &Ui) -> Result<Vec<YearEntry>> {
    std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
    let (first, last) = network
        .years()
        .context("no dated paper: nothing to lay out by year")?;
    let bucket = |year: u16| if year == YEAR_UNKNOWN { last } else { year };
    let mut open: BTreeMap<u16, OpenFile> = BTreeMap::new();
    let mut new_pairs: BTreeMap<u16, usize> = BTreeMap::new();
    let mut previous = None;
    for (u, v, year, strength) in network.strengths() {
        let year = bucket(year);
        if previous != Some((u, v)) {
            previous = Some((u, v));
            *new_pairs.entry(year).or_default() += 1;
        }
        let file = match open.entry(year) {
            Entry::Occupied(entry) => entry.into_mut(),
            Entry::Vacant(entry) => {
                entry.insert(OpenFile::create(dir, &strengths_name(year), args.gzip)?)
            }
        };
        writeln!(file.sink, "{u} {v} {strength}")?;
        file.lines += 1;
    }
    let mut years = Vec::with_capacity(usize::from(last - first) + 1);
    let mut edges = 0;
    let mut bytes = 0;
    for year in first..=last {
        let strengths = match open.remove(&year) {
            Some(file) => file,
            None => OpenFile::create(dir, &strengths_name(year), args.gzip)?,
        };
        let pairs = strengths.lines;
        let strengths = strengths.close()?;
        let before = year
            .checked_sub(1)
            .map_or(0, |previous| network.vertex_count(Some(previous)));
        let until = if year == last { None } else { Some(year) };
        let names = write_file(dir, &format!("names_{year}.txt"), args.gzip, |out| {
            let mut out = BufWriter::new(out);
            let mut count = 0;
            for (v, name) in network.names(until).skip(before) {
                writeln!(out, "{v},{name}")?;
                count += 1;
            }
            out.flush()?;
            Ok(count)
        })?;
        edges += new_pairs.get(&year).copied().unwrap_or(0);
        bytes += strengths.bytes + names.info.bytes;
        years.push(YearEntry {
            year,
            vertices: network.vertex_count(until),
            edges,
            pairs,
            strengths,
            names: names.info,
        });
    }
    ui.kv(
        "by year",
        format!(
            "{} years, {first} to {last}, {}",
            years.len(),
            ui::bytes(bytes as usize)
        ),
    );
    Ok(years)
}

fn strengths_name(year: u16) -> String {
    format!("strengths_{year}.txt")
}

fn write_tier(network: &Network, until: Option<u16>, args: &Args, ui: &Ui) -> Result<Tier> {
    let suffix = until.map_or(String::new(), |year| format!("_{year}"));
    let graph = write_file(
        &args.out,
        &format!("{}{suffix}.txt", args.name),
        args.gzip,
        |out| network.write_edges(until, out),
    )?;
    let names = write_file(
        &args.out,
        &format!("{}{suffix}_vertices.txt", args.name),
        args.gzip,
        |out| network.write_names(until, out),
    )?;
    let vertices = network.vertex_count(until);
    ui.kv(
        &until.map_or("whole".to_owned(), |year| format!("up to {year}")),
        format!(
            "{vertices} vertices, {} edges, {} + {}",
            graph.count,
            ui::bytes(graph.info.bytes as usize),
            ui::bytes(names.info.bytes as usize)
        ),
    );
    Ok(Tier {
        year: until,
        vertices,
        edges: graph.count,
        graph: graph.info,
        names: names.info,
    })
}

struct Written {
    info: FileInfo,
    count: usize,
}

/// Writes one file, plain or gzipped, counting the bytes before and after
/// compression.
fn write_file(
    dir: &Path,
    name: &str,
    gzip: bool,
    write: impl FnOnce(&mut dyn Write) -> io::Result<usize>,
) -> Result<Written> {
    let mut open = OpenFile::create(dir, name, gzip)?;
    let count =
        write(&mut open.sink).with_context(|| format!("writing {}", open.path.display()))?;
    Ok(Written {
        info: open.close()?,
        count,
    })
}

/// A file being written, plain or gzipped, with its bytes counted.
struct OpenFile {
    path: PathBuf,
    file: String,
    sink: CountingWrite<Sink>,
    lines: usize,
}

impl OpenFile {
    fn create(dir: &Path, name: &str, gzip: bool) -> Result<Self> {
        let file = if gzip {
            format!("{name}.gz")
        } else {
            name.to_owned()
        };
        let path = dir.join(&file);
        let created =
            File::create(&path).with_context(|| format!("creating {}", path.display()))?;
        Ok(Self {
            sink: CountingWrite {
                inner: Sink::new(created, gzip),
                written: 0,
            },
            path,
            file,
            lines: 0,
        })
    }

    /// Flushes and closes, giving the sizes on disk and before compression.
    fn close(self) -> Result<FileInfo> {
        let raw_bytes = self.sink.written;
        self.sink
            .inner
            .finish()
            .with_context(|| format!("finishing {}", self.path.display()))?;
        let bytes = std::fs::metadata(&self.path)?.len();
        Ok(FileInfo {
            file: self.file,
            bytes,
            raw_bytes,
        })
    }
}

/// A plain or gzipped file being written.
enum Sink {
    Plain(BufWriter<File>),
    Gz(GzEncoder<BufWriter<File>>),
}

impl Sink {
    fn new(file: File, gzip: bool) -> Self {
        let buffered = BufWriter::with_capacity(1 << 20, file);
        if gzip {
            Self::Gz(GzEncoder::new(buffered, Compression::default()))
        } else {
            Self::Plain(buffered)
        }
    }

    fn finish(self) -> io::Result<()> {
        match self {
            Self::Plain(mut inner) => inner.flush(),
            Self::Gz(encoder) => encoder.finish()?.flush(),
        }
    }
}

impl Write for Sink {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match self {
            Self::Plain(inner) => inner.write(buf),
            Self::Gz(inner) => inner.write(buf),
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        match self {
            Self::Plain(inner) => inner.flush(),
            Self::Gz(inner) => inner.flush(),
        }
    }
}

/// A writer that counts what passes through, for the uncompressed size.
struct CountingWrite<W> {
    inner: W,
    written: u64,
}

impl<W: Write> Write for CountingWrite<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let n = self.inner.write(buf)?;
        self.written += n as u64;
        Ok(n)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// `README.md` beside the files: what they are and how they were made,
/// which the monthly release on GitHub uses as its notes.
fn readme(manifest: &Manifest, args: &Args) -> String {
    let mut text = String::new();
    let when = manifest
        .date
        .map_or(String::new(), |date| format!(" of {date}"));
    text.push_str(&format!("# DBLP collaboration network{when}\n\n"));
    text.push_str(&format!(
        "Built from `{}`{} on {} by `{}`: a vertex per researcher with at least one \
         co-authored record in DBLP, an edge per pair of researchers with a record in \
         common, and on each edge 1 / the number of records they share, so no weight \
         passes 1 (the course's 2009 file follows an older rule, with weights up to \
         113).{}\n\n",
        manifest.dump,
        manifest
            .source
            .map_or(String::new(), |source| format!(" ({source})")),
        civil_date(manifest.built_at),
        manifest.generator,
        if manifest.formal_only {
            " Informal publications (preprints) were left out."
        } else {
            ""
        }
    ));
    text.push_str("| File | Up to | Vertices | Edges | Size |\n|---|---|---:|---:|---|\n");
    for tier in &manifest.tiers {
        let up_to = tier
            .year
            .map_or("everything".to_owned(), |year| year.to_string());
        text.push_str(&format!(
            "| `{}` + `{}` | {up_to} | {} | {} | {} + {} ({} + {} unpacked) |\n",
            tier.graph.file,
            tier.names.file,
            tier.vertices,
            tier.edges,
            ui::bytes(tier.graph.bytes as usize),
            ui::bytes(tier.names.bytes as usize),
            ui::bytes(tier.graph.raw_bytes as usize),
            ui::bytes(tier.names.raw_bytes as usize),
        ));
    }
    text.push_str(&format!(
        "\nRecords read: {}: {} skipped (author pages{}), {} with two or more authors, the \
         rest with one. Researchers: {}. Collaborations: {}.{}\n\nThe edge files are the \
         course format: the vertex count, then `u v weight` per line; the names files map \
         `vertex,name`. Vertices are numbered by the year of their first co-authored \
         paper, then by name, so a year's names are the first lines of the whole \
         network's.\n",
        manifest.records,
        manifest.skipped,
        if args.formal_only {
            " and informal publications"
        } else {
            ""
        },
        manifest.papers,
        manifest.authors,
        manifest.edges,
        match (manifest.first_year, manifest.last_year) {
            (Some(first), Some(last)) => format!(" Years: {first} to {last}."),
            _ => String::new(),
        },
    ));
    text
}

/// `YYYY-MM-DD` of a Unix timestamp (UTC), the civil-from-days algorithm.
fn civil_date(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    const DUMP: &[u8] = b"<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?>
<!DOCTYPE dblp SYSTEM \"dblp.dtd\">
<dblp>
<article mdate=\"2020-01-01\" key=\"journals/x/A01\">
<author orcid=\"0000\">Ana Lima</author><author>&Eacute;va Tardos</author>
<author>Jo&#227;o Cl\xe1udio</author>
<title>Title with <i>markup</i> &amp; an entity.</title>
<year>2001</year>
</article>
<inproceedings key=\"conf/y/B\" publtype=\"informal\">
<author>Ana Lima</author><author>Bia Souza</author>
</inproceedings>
<www key=\"homepages/1\"><author>Ana Lima</author><author>A. Lima</author></www>
<article key=\"journals/x/S99\"><author>Solo Writer</author><year>1999</year></article>
<proceedings key=\"conf/y/2001\"><editor>Ed Itor</editor><year>2001</year></proceedings>
</dblp>
";

    #[test]
    fn reads_records_decoding_latin1_and_entities() {
        let dump = read_dump(DUMP, false, &mut || {}).unwrap();
        assert_eq!(dump.records, 5);
        assert_eq!(dump.skipped, 1);
        assert_eq!(dump.papers_counted, 2);
        let network = dump.papers.finish();
        let names: Vec<_> = network.names(None).map(|(_, name)| name).collect();
        // 2001 first, by name; the undated paper's new author last.
        assert_eq!(
            names,
            ["Ana Lima", "João Cláudio", "Éva Tardos", "Bia Souza"]
        );
        let edges: Vec<_> = network.edges(None).collect();
        assert_eq!(edges, [(1, 2, 1.0), (1, 3, 1.0), (1, 4, 1.0), (2, 3, 1.0)]);
        assert_eq!(network.edge_count(Some(2001)), 3);
    }

    #[test]
    fn formal_only_skips_informal_records() {
        let dump = read_dump(DUMP, true, &mut || {}).unwrap();
        assert_eq!(dump.skipped, 2);
        assert_eq!(dump.papers_counted, 1);
        assert_eq!(dump.papers.author_count(), 3);
    }

    #[test]
    fn years_and_dates() {
        assert_eq!(parse_year("2009"), Some(2009));
        assert_eq!(parse_year(" 1999 "), Some(1999));
        assert_eq!(parse_year("99"), None);
        assert_eq!(parse_year("n/a"), None);
        assert_eq!(civil_date(0), "1970-01-01");
        assert_eq!(civil_date(1_793_750_400), "2026-11-04");
    }

    #[test]
    fn latin1_is_widened_only_when_declared() {
        assert!(declares_latin1(
            b"<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?>\n<dblp>"
        ));
        assert!(declares_latin1(b"<?xml version='1.0' encoding='latin1'?>"));
        assert!(!declares_latin1(
            b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        ));
        assert!(!declares_latin1(b"<dblp>"));
        let mut widened = String::new();
        Transcoded::new(b"<?xml encoding=\"ISO-8859-1\"?><a>\xe1\xc9</a>".as_slice())
            .unwrap()
            .read_to_string(&mut widened)
            .unwrap();
        assert_eq!(widened, "<?xml encoding=\"ISO-8859-1\"?><a>áÉ</a>");
        let mut same = Vec::new();
        Transcoded::new("<?xml encoding=\"UTF-8\"?><a>á</a>".as_bytes())
            .unwrap()
            .read_to_end(&mut same)
            .unwrap();
        assert_eq!(same, "<?xml encoding=\"UTF-8\"?><a>á</a>".as_bytes());
    }

    #[test]
    fn malformed_xml_is_an_error() {
        let Err(error) = read_dump(
            &b"<dblp><article><author>A &unterminated"[..],
            false,
            &mut || {},
        ) else {
            panic!("an unterminated reference parsed")
        };
        assert!(error.to_string().contains("malformed XML"), "{error}");
    }
}
