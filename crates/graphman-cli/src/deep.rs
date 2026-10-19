//! Room for the recursive DFS: one call per tree level, and a DFS tree can be
//! as deep as the graph has vertices (the course graphs have millions). The
//! main thread's stack holds tens of thousands of calls, so the recursive
//! DFS runs on a thread whose stack is sized for the worst case: reserved,
//! not committed, so only the depth actually reached costs memory.

/// Stack per recursive call, with room to spare: a release build uses about
/// 100 bytes per call (96 on CSR and lists, 112 on the matrix), a debug
/// build several times that.
const FRAME_BYTES: usize = 512;

/// Stack for everything that is not the recursion.
const BASE_BYTES: usize = 16 << 20;

/// Runs `f` on a thread whose stack holds a recursion `depth` calls deep.
pub fn with_stack_for<R: Send>(depth: usize, f: impl FnOnce() -> R + Send) -> R {
    std::thread::scope(|scope| {
        std::thread::Builder::new()
            .name("recursive-dfs".into())
            .stack_size(BASE_BYTES.saturating_add(depth.saturating_mul(FRAME_BYTES)))
            .spawn_scoped(scope, f)
            .expect("spawning the recursive DFS thread")
            .join()
            .unwrap_or_else(|panic| std::panic::resume_unwind(panic))
    })
}
