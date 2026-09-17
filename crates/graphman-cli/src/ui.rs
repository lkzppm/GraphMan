//! Terminal output helpers. Everything decorative goes to stderr so that
//! stdout stays clean for machine-readable output (`--json`).

use indicatif::{ProgressBar, ProgressStyle};
use owo_colors::OwoColorize;
use std::time::Duration;

/// Styled, optionally silent, terminal reporter.
#[derive(Clone, Copy)]
pub struct Ui {
    quiet: bool,
}

impl Ui {
    pub fn new(quiet: bool) -> Self {
        Self { quiet }
    }

    /// A section title.
    pub fn title(&self, text: &str) {
        if !self.quiet {
            eprintln!("\n{} {}", "graphman".blue().bold(), text.bold());
        }
    }

    /// A step that is starting.
    pub fn step(&self, text: &str) {
        if !self.quiet {
            eprintln!("  {} {text}", "›".blue());
        }
    }

    /// A key/value line.
    pub fn kv(&self, key: &str, value: impl std::fmt::Display) {
        if !self.quiet {
            eprintln!("    {:<18} {}", key.dimmed(), value);
        }
    }

    /// A completed step.
    pub fn done(&self, text: &str) {
        if !self.quiet {
            eprintln!("  {} {text}", "✓".green());
        }
    }

    /// A warning.
    pub fn warn(&self, text: &str) {
        if !self.quiet {
            eprintln!("  {} {}", "!".yellow().bold(), text.yellow());
        }
    }

    /// A progress bar (hidden when quiet). `len == None` gives a spinner.
    pub fn progress(&self, len: Option<u64>, message: &str) -> ProgressBar {
        if self.quiet {
            return ProgressBar::hidden();
        }
        let bar = match len {
            Some(len) => ProgressBar::new(len).with_style(
                ProgressStyle::with_template(
                    "    {msg:<22} {bar:32.blue/dim} {pos}/{len} {elapsed_precise} eta {eta}",
                )
                .expect("static template")
                .progress_chars("━╸─"),
            ),
            None => ProgressBar::new_spinner().with_style(
                ProgressStyle::with_template(
                    "    {msg:<22} {spinner:.blue} {pos} {elapsed_precise}",
                )
                .expect("static template"),
            ),
        };
        bar.set_message(message.to_string());
        bar.enable_steady_tick(Duration::from_millis(80));
        bar
    }
}

/// Human readable bytes with SI units (the assignment asks for MB).
pub fn bytes(n: usize) -> String {
    const UNITS: [&str; 5] = ["B", "kB", "MB", "GB", "TB"];
    let mut value = n as f64;
    let mut unit = 0;
    while value >= 1000.0 && unit < UNITS.len() - 1 {
        value /= 1000.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{n} B")
    } else {
        format!("{value:.2} {}", UNITS[unit])
    }
}

/// Human readable duration.
pub fn duration(d: Duration) -> String {
    let ms = d.as_secs_f64() * 1000.0;
    if ms < 1.0 {
        format!("{:.1} µs", ms * 1000.0)
    } else if ms < 1000.0 {
        format!("{ms:.2} ms")
    } else if ms < 60_000.0 {
        format!("{:.2} s", ms / 1000.0)
    } else {
        format!("{:.1} min", ms / 60_000.0)
    }
}
