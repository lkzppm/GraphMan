//! The order in which Bellman-Ford re-examines vertices, as a strategy.
//!
//! Every Bellman-Ford variant is the same loop: take a vertex, relax its
//! out-arcs, and say which neighbours improved. They differ only in **which
//! vertex comes next** and **when a pass ends**, so that is all a
//! [`Schedule`] decides; [`bellman_ford_into`](super::bellman_ford_into) is
//! written once over it, the way Dijkstra is written once over a
//! [`Frontier`](super::Frontier).
//!
//! | [`ScheduleKind`] | Order | Passes, worst case |
//! |---|---|---|
//! | `rounds` | every vertex, by id, `n − 1` times (the textbook) | `n − 1`, then one to confirm |
//! | `early-stop` | every vertex, by id, until a pass changes nothing | `≤ n` |
//! | `queue` | a FIFO of the vertices lowered since their last scan (Bellman-Ford-Moore) | `≤ n`, `O(nm)` |
//! | `yen` | the lowered vertices, by id up then down (Yen, 1970) | `≤ ⌈n / 2⌉ + 1` |
//! | `random-yen` | `yen` over a random order (Bannister and Eppstein, 2012) | `≈ n / 3` expected |
//! | `slf` | the queue as a deque, a lowered vertex in front when it beats the front (Bertsekas, 1993) | `O(nm)` |
//!
//! `early-stop` is the first optimisation discussed in class (stop when a
//! pass changes nothing); `queue` adds the second (re-examine only the
//! vertices whose estimate changed).
//!
//! No schedule caps the number of passes: a run ends when nothing is left
//! to re-examine. With a negative cycle that never happens, and the driver
//! stops the run when it finds the cycle.

use crate::graph::{Vertex, Weight};
use core::fmt;
use core::mem::size_of;
use core::str::FromStr;
use std::collections::VecDeque;

/// Where a Bellman-Ford run starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Start {
    /// From one vertex, at distance 0.
    Vertex(Vertex),
    /// From every vertex at once, each at distance 0: Bellman-Ford from a
    /// virtual vertex with a 0-weight arc to every vertex, without adding
    /// the vertex. It answers whether the graph has a negative cycle
    /// anywhere, and its distances are Johnson's potentials.
    Everywhere,
}

impl Start {
    /// The vertices active at the start, in id order.
    fn vertices(self, vertex_count: usize) -> impl Iterator<Item = Vertex> {
        let (first, last) = match self {
            Start::Vertex(v) => (v, v),
            Start::Everywhere => (1, vertex_count as Vertex),
        };
        first..=last
    }
}

/// Which vertex Bellman-Ford scans next, and when a pass ends.
pub trait Schedule {
    /// Prepares for a run on `vertex_count` vertices from `start`.
    fn reset(&mut self, vertex_count: usize, start: Start);

    /// The next vertex whose out-arcs to relax, or `None` when no estimate
    /// can change any more and the run is over.
    fn next(&mut self) -> Option<Vertex>;

    /// The estimate of `v` just went down (to `distance[v]`).
    fn lowered(&mut self, v: Vertex, distance: &[Weight]);

    /// Passes completed so far.
    fn passes(&self) -> usize;

    /// Which strategy this is.
    fn kind(&self) -> ScheduleKind;

    /// Bytes the schedule owns on the heap.
    fn heap_bytes(&self) -> usize;
}

/// The Bellman-Ford schedules offered by the library.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "kebab-case"))]
pub enum ScheduleKind {
    /// `n − 1` passes over every vertex, then one to confirm.
    Rounds,
    /// Passes over every vertex until one changes nothing.
    EarlyStop,
    /// A FIFO of the vertices whose estimate went down (Bellman-Ford-Moore).
    Queue,
    /// The lowered vertices, by id up then down (Yen).
    Yen,
    /// Yen over a random vertex order (Bannister and Eppstein).
    RandomYen,
    /// Small Label First: the queue as a deque (Bertsekas).
    Slf,
}

impl ScheduleKind {
    /// Every schedule, in the order they are usually reported.
    pub const ALL: [ScheduleKind; 6] = [
        ScheduleKind::Rounds,
        ScheduleKind::EarlyStop,
        ScheduleKind::Queue,
        ScheduleKind::Yen,
        ScheduleKind::RandomYen,
        ScheduleKind::Slf,
    ];

    /// Command-line identifier.
    pub fn label(self) -> &'static str {
        match self {
            ScheduleKind::Rounds => "rounds",
            ScheduleKind::EarlyStop => "early-stop",
            ScheduleKind::Queue => "queue",
            ScheduleKind::Yen => "yen",
            ScheduleKind::RandomYen => "random-yen",
            ScheduleKind::Slf => "slf",
        }
    }

    /// Human readable name.
    pub fn name(self) -> &'static str {
        match self {
            ScheduleKind::Rounds => "n - 1 rounds",
            ScheduleKind::EarlyStop => "rounds with early stop",
            ScheduleKind::Queue => "queue of changed vertices",
            ScheduleKind::Yen => "Yen's up and down sweeps",
            ScheduleKind::RandomYen => "Yen's sweeps in random order",
            ScheduleKind::Slf => "small label first",
        }
    }

    /// A fresh schedule of this kind.
    pub fn schedule(self) -> AnySchedule {
        match self {
            ScheduleKind::Rounds => AnySchedule::Sweep(SweepSchedule::rounds()),
            ScheduleKind::EarlyStop => AnySchedule::Sweep(SweepSchedule::early_stop()),
            ScheduleKind::Queue => AnySchedule::Queue(QueueSchedule::fifo()),
            ScheduleKind::Yen => AnySchedule::Yen(YenSchedule::new()),
            ScheduleKind::RandomYen => {
                AnySchedule::Yen(YenSchedule::random(YenSchedule::DEFAULT_SEED))
            }
            ScheduleKind::Slf => AnySchedule::Queue(QueueSchedule::slf()),
        }
    }
}

impl fmt::Display for ScheduleKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.label())
    }
}

impl FromStr for ScheduleKind {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let s = s.trim().to_ascii_lowercase().replace('_', "-");
        ScheduleKind::ALL
            .into_iter()
            .find(|kind| kind.label() == s)
            .or(match s.as_str() {
                "textbook" | "plain" => Some(ScheduleKind::Rounds),
                "spfa" | "fifo" | "bfm" => Some(ScheduleKind::Queue),
                _ => None,
            })
            .ok_or_else(|| {
                format!(
                    "unknown schedule {s:?} (expected rounds, early-stop, queue, yen, random-yen or slf)"
                )
            })
    }
}

/// One bit per vertex.
#[derive(Debug, Clone, Default)]
struct Bits(Vec<u64>);

impl Bits {
    fn resize(&mut self, vertex_count: usize) {
        self.0.clear();
        self.0.resize((vertex_count + 1).div_ceil(64), 0);
    }

    #[inline(always)]
    fn get(&self, v: Vertex) -> bool {
        self.0[(v >> 6) as usize] & (1u64 << (v & 63)) != 0
    }

    #[inline(always)]
    fn set(&mut self, v: Vertex) {
        self.0[(v >> 6) as usize] |= 1u64 << (v & 63);
    }

    #[inline(always)]
    fn clear(&mut self, v: Vertex) {
        self.0[(v >> 6) as usize] &= !(1u64 << (v & 63));
    }

    fn heap_bytes(&self) -> usize {
        self.0.capacity() * size_of::<u64>()
    }
}

/// Passes over every vertex in id order: the textbook ([`rounds`](Self::rounds))
/// or with the first optimisation ([`early_stop`](Self::early_stop)).
///
/// Holds no per-vertex state at all: every pass scans every vertex.
#[derive(Debug, Clone)]
pub struct SweepSchedule {
    vertex_count: usize,
    cursor: usize,
    passes: usize,
    changed: bool,
    /// Rounds: at least `n − 1` passes, whatever they change.
    full: bool,
}

impl SweepSchedule {
    /// The textbook: `n − 1` passes over every vertex, then passes until one
    /// changes nothing (one, without a negative cycle).
    pub fn rounds() -> Self {
        Self::with(true)
    }

    /// Passes over every vertex until one changes nothing.
    pub fn early_stop() -> Self {
        Self::with(false)
    }

    fn with(full: bool) -> Self {
        Self {
            vertex_count: 0,
            cursor: 1,
            passes: 0,
            changed: false,
            full,
        }
    }
}

impl Schedule for SweepSchedule {
    fn reset(&mut self, vertex_count: usize, _start: Start) {
        self.vertex_count = vertex_count;
        self.cursor = 1;
        self.passes = 0;
        self.changed = false;
    }

    #[inline]
    fn next(&mut self) -> Option<Vertex> {
        if self.cursor > self.vertex_count {
            self.passes += 1;
            let minimum = match self.full {
                true => self.vertex_count.saturating_sub(1),
                false => 0,
            };
            if !self.changed && self.passes >= minimum {
                return None;
            }
            self.changed = false;
            self.cursor = 1;
        }
        let v = self.cursor as Vertex;
        self.cursor += 1;
        Some(v)
    }

    #[inline]
    fn lowered(&mut self, _v: Vertex, _distance: &[Weight]) {
        self.changed = true;
    }

    fn passes(&self) -> usize {
        self.passes
    }

    fn kind(&self) -> ScheduleKind {
        match self.full {
            true => ScheduleKind::Rounds,
            false => ScheduleKind::EarlyStop,
        }
    }

    fn heap_bytes(&self) -> usize {
        0
    }
}

/// A queue of the vertices whose estimate went down since they were last
/// scanned, each at most once: FIFO ([`fifo`](Self::fifo), Bellman-Ford-Moore)
/// or Small Label First ([`slf`](Self::slf)).
///
/// A pass is one generation of the queue: the vertices that were in it when
/// the previous generation ran out.
#[derive(Debug, Clone)]
pub struct QueueSchedule {
    queue: VecDeque<Vertex>,
    queued: Bits,
    left_in_pass: usize,
    passes: usize,
    small_label_first: bool,
}

impl QueueSchedule {
    /// Bellman-Ford-Moore: lowered vertices join at the back.
    pub fn fifo() -> Self {
        Self::with(false)
    }

    /// Small Label First: a lowered vertex joins at the front when its
    /// estimate is below the front's, at the back otherwise.
    pub fn slf() -> Self {
        Self::with(true)
    }

    fn with(small_label_first: bool) -> Self {
        Self {
            queue: VecDeque::new(),
            queued: Bits::default(),
            left_in_pass: 0,
            passes: 0,
            small_label_first,
        }
    }
}

impl Schedule for QueueSchedule {
    fn reset(&mut self, vertex_count: usize, start: Start) {
        self.queue.clear();
        self.queued.resize(vertex_count);
        for v in start.vertices(vertex_count) {
            self.queue.push_back(v);
            self.queued.set(v);
        }
        self.left_in_pass = self.queue.len();
        self.passes = 0;
    }

    #[inline]
    fn next(&mut self) -> Option<Vertex> {
        if self.left_in_pass == 0 {
            self.passes += 1;
            self.left_in_pass = self.queue.len();
        }
        let v = self.queue.pop_front()?;
        self.left_in_pass -= 1;
        self.queued.clear(v);
        Some(v)
    }

    #[inline]
    fn lowered(&mut self, v: Vertex, distance: &[Weight]) {
        if self.queued.get(v) {
            return;
        }
        self.queued.set(v);
        match self.queue.front() {
            Some(&front)
                if self.small_label_first && distance[v as usize] < distance[front as usize] =>
            {
                self.queue.push_front(v)
            }
            _ => self.queue.push_back(v),
        }
    }

    fn passes(&self) -> usize {
        self.passes
    }

    fn kind(&self) -> ScheduleKind {
        match self.small_label_first {
            true => ScheduleKind::Slf,
            false => ScheduleKind::Queue,
        }
    }

    fn heap_bytes(&self) -> usize {
        self.queue.capacity() * size_of::<Vertex>() + self.queued.heap_bytes()
    }
}

/// Yen's schedule: each pass sweeps the vertices up an order, then back
/// down it, scanning only those lowered since their last scan.
///
/// A shortest path alternates runs that climb the order and runs that
/// descend it; one up sweep relaxes a whole climbing run and one down sweep
/// a whole descending one, so a pass extends every shortest path by at
/// least two runs: `⌈n / 2⌉` passes instead of `n − 1`. Over a random order
/// ([`random`](Self::random)) the runs get longer, about `n / 3` passes
/// expected.
#[derive(Debug, Clone)]
pub struct YenSchedule {
    order: Vec<Vertex>,
    /// `0..n` up the order, `n..2n` back down it.
    position: usize,
    dirty: Bits,
    changed: bool,
    passes: usize,
    /// `None`: vertices in id order.
    seed: Option<u64>,
}

impl YenSchedule {
    /// The seed `random-yen` uses unless told otherwise.
    pub const DEFAULT_SEED: u64 = 0x5EED_B311_FA4D;

    /// Yen over the vertex ids.
    pub fn new() -> Self {
        Self::with(None)
    }

    /// Yen over a random order of the vertices, drawn from `seed` (the same
    /// seed gives the same order, so runs are reproducible).
    pub fn random(seed: u64) -> Self {
        Self::with(Some(seed))
    }

    fn with(seed: Option<u64>) -> Self {
        Self {
            order: Vec::new(),
            position: 0,
            dirty: Bits::default(),
            changed: false,
            passes: 0,
            seed,
        }
    }
}

impl Default for YenSchedule {
    fn default() -> Self {
        Self::new()
    }
}

impl Schedule for YenSchedule {
    fn reset(&mut self, vertex_count: usize, start: Start) {
        if self.order.len() != vertex_count {
            self.order = (1..=vertex_count as Vertex).collect();
            if let Some(seed) = self.seed {
                shuffle(&mut self.order, seed);
            }
        }
        self.dirty.resize(vertex_count);
        for v in start.vertices(vertex_count) {
            self.dirty.set(v);
        }
        self.position = 0;
        self.changed = false;
        self.passes = 0;
    }

    #[inline]
    fn next(&mut self) -> Option<Vertex> {
        let n = self.order.len();
        loop {
            if self.position == 2 * n {
                self.passes += 1;
                if !self.changed {
                    return None;
                }
                self.changed = false;
                self.position = 0;
            }
            let index = match self.position < n {
                true => self.position,
                false => 2 * n - 1 - self.position,
            };
            self.position += 1;
            let v = self.order[index];
            if self.dirty.get(v) {
                self.dirty.clear(v);
                return Some(v);
            }
        }
    }

    #[inline]
    fn lowered(&mut self, v: Vertex, _distance: &[Weight]) {
        self.dirty.set(v);
        self.changed = true;
    }

    fn passes(&self) -> usize {
        self.passes
    }

    fn kind(&self) -> ScheduleKind {
        match self.seed {
            None => ScheduleKind::Yen,
            Some(_) => ScheduleKind::RandomYen,
        }
    }

    fn heap_bytes(&self) -> usize {
        self.order.capacity() * size_of::<Vertex>() + self.dirty.heap_bytes()
    }
}

/// Fisher-Yates with SplitMix64, so the library needs no random-number crate.
fn shuffle(items: &mut [Vertex], seed: u64) {
    let mut state = seed;
    let mut next = || {
        state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    };
    for i in (1..items.len()).rev() {
        let j = (next() % (i as u64 + 1)) as usize;
        items.swap(i, j);
    }
}

/// Any schedule, chosen at runtime by its [`ScheduleKind`].
#[derive(Debug, Clone)]
pub enum AnySchedule {
    /// `rounds` or `early-stop`.
    Sweep(SweepSchedule),
    /// `queue` or `slf`.
    Queue(QueueSchedule),
    /// `yen` or `random-yen`.
    Yen(YenSchedule),
}

macro_rules! each {
    ($self:expr, $s:ident => $body:expr) => {
        match $self {
            AnySchedule::Sweep($s) => $body,
            AnySchedule::Queue($s) => $body,
            AnySchedule::Yen($s) => $body,
        }
    };
}

impl Schedule for AnySchedule {
    fn reset(&mut self, vertex_count: usize, start: Start) {
        each!(self, s => s.reset(vertex_count, start))
    }

    #[inline]
    fn next(&mut self) -> Option<Vertex> {
        each!(self, s => s.next())
    }

    #[inline]
    fn lowered(&mut self, v: Vertex, distance: &[Weight]) {
        each!(self, s => s.lowered(v, distance))
    }

    fn passes(&self) -> usize {
        each!(self, s => s.passes())
    }

    fn kind(&self) -> ScheduleKind {
        each!(self, s => s.kind())
    }

    fn heap_bytes(&self) -> usize {
        each!(self, s => s.heap_bytes())
    }
}

/// What a [`MeasuredSchedule`] counted during a run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ScheduleCounts {
    /// Vertices handed to the driver (each one's arcs are relaxed when it
    /// is reached).
    pub scans: usize,
    /// Improving relaxations: estimates that went down.
    pub lowered: usize,
    /// Passes completed.
    pub passes: usize,
}

/// Wraps a schedule and counts its work, so a study can put "how much" next
/// to "how long".
#[derive(Debug, Clone)]
pub struct MeasuredSchedule<S> {
    inner: S,
    scans: usize,
    lowered: usize,
}

impl<S: Schedule> MeasuredSchedule<S> {
    /// Wraps `inner`.
    pub fn new(inner: S) -> Self {
        Self {
            inner,
            scans: 0,
            lowered: 0,
        }
    }

    /// What the last run did.
    pub fn counts(&self) -> ScheduleCounts {
        ScheduleCounts {
            scans: self.scans,
            lowered: self.lowered,
            passes: self.inner.passes(),
        }
    }
}

impl<S: Schedule> Schedule for MeasuredSchedule<S> {
    fn reset(&mut self, vertex_count: usize, start: Start) {
        self.scans = 0;
        self.lowered = 0;
        self.inner.reset(vertex_count, start);
    }

    #[inline]
    fn next(&mut self) -> Option<Vertex> {
        let v = self.inner.next();
        self.scans += usize::from(v.is_some());
        v
    }

    #[inline]
    fn lowered(&mut self, v: Vertex, distance: &[Weight]) {
        self.lowered += 1;
        self.inner.lowered(v, distance);
    }

    fn passes(&self) -> usize {
        self.inner.passes()
    }

    fn kind(&self) -> ScheduleKind {
        self.inner.kind()
    }

    fn heap_bytes(&self) -> usize {
        self.inner.heap_bytes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The vertices a schedule hands out when nothing is ever lowered.
    fn drain(schedule: &mut impl Schedule, n: usize, start: Start) -> Vec<Vertex> {
        schedule.reset(n, start);
        core::iter::from_fn(|| schedule.next()).collect()
    }

    #[test]
    fn rounds_scan_every_vertex_n_minus_one_times() {
        let mut rounds = SweepSchedule::rounds();
        assert_eq!(drain(&mut rounds, 4, Start::Vertex(2)).len(), 3 * 4);
        assert_eq!(rounds.passes(), 3);
        let mut early = SweepSchedule::early_stop();
        assert_eq!(drain(&mut early, 4, Start::Vertex(2)), [1, 2, 3, 4]);
        assert_eq!(early.passes(), 1);
    }

    #[test]
    fn queues_start_from_the_start_vertices() {
        for mut queue in [QueueSchedule::fifo(), QueueSchedule::slf()] {
            assert_eq!(drain(&mut queue, 5, Start::Vertex(3)), [3]);
            assert_eq!(queue.passes(), 1);
            assert_eq!(drain(&mut queue, 3, Start::Everywhere), [1, 2, 3]);
        }
        // A lowered vertex is queued once, at the back (FIFO) or in front
        // when its estimate beats the front's (SLF).
        let distance = [0.0, 0.0, 5.0, 1.0, 9.0];
        let mut fifo = QueueSchedule::fifo();
        fifo.reset(4, Start::Vertex(1));
        assert_eq!(fifo.next(), Some(1));
        for v in [2, 3, 2, 4] {
            fifo.lowered(v, &distance);
        }
        let mut slf = QueueSchedule::slf();
        slf.reset(4, Start::Vertex(1));
        assert_eq!(slf.next(), Some(1));
        for v in [2, 3, 2, 4] {
            slf.lowered(v, &distance);
        }
        assert_eq!(
            core::iter::from_fn(|| fifo.next()).collect::<Vec<_>>(),
            [2, 3, 4]
        );
        assert_eq!(
            core::iter::from_fn(|| slf.next()).collect::<Vec<_>>(),
            [3, 2, 4]
        );
        assert_eq!(fifo.passes(), 2);
    }

    #[test]
    fn yen_sweeps_up_then_down_over_the_lowered_vertices() {
        let mut yen = YenSchedule::new();
        yen.reset(5, Start::Vertex(3));
        assert_eq!(yen.next(), Some(3));
        yen.lowered(5, &[]);
        yen.lowered(1, &[]);
        // Up the order finds 5, back down finds 1.
        assert_eq!(yen.next(), Some(5));
        assert_eq!(yen.next(), Some(1));
        assert_eq!(yen.next(), None);
        assert_eq!(yen.passes(), 2);

        let mut random = YenSchedule::random(7);
        let order = drain(&mut random, 50, Start::Everywhere);
        let mut sorted = order.clone();
        sorted.sort_unstable();
        assert_eq!(sorted, (1..=50).collect::<Vec<_>>());
        assert_ne!(order, sorted);
        assert_eq!(
            drain(&mut YenSchedule::random(7), 50, Start::Everywhere),
            order
        );
    }

    #[test]
    fn kinds_parse_and_build_their_schedule() {
        for kind in ScheduleKind::ALL {
            assert_eq!(kind.label().parse::<ScheduleKind>(), Ok(kind));
            assert_eq!(kind.schedule().kind(), kind);
        }
        assert_eq!("SPFA".parse(), Ok(ScheduleKind::Queue));
        assert!("dijkstra".parse::<ScheduleKind>().is_err());
    }
}
