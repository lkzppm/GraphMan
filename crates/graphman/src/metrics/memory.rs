//! Resident-set-size and physical-memory queries.
//!
//! The assignment asks for "the memory used by the program after loading the
//! graph": that is the memory of the *process*, not the size of the data
//! structure. Both are reported by the case studies; the gap between them is
//! allocator overhead and the program's own baseline.
//!
//! Two process-level numbers are exposed because operating systems disagree
//! on what "memory used" means:
//!
//! * [`resident_bytes`] — the resident set size (RSS): physical pages mapped
//!   into the process right now, including shared and file-backed ones.
//! * [`footprint_bytes`] — on macOS the *physical footprint* (what Activity
//!   Monitor shows), which counts anonymous memory the process is
//!   responsible for, including compressed pages; on Linux the anonymous RSS.

/// Bytes of physical memory currently resident for this process.
pub fn resident_bytes() -> Option<usize> {
    imp::resident_bytes()
}

/// Bytes of memory this process is charged for (see the module docs).
pub fn footprint_bytes() -> Option<usize> {
    imp::footprint_bytes()
}

/// Peak resident bytes since the process started.
pub fn peak_resident_bytes() -> Option<usize> {
    imp::peak_resident_bytes()
}

/// Physical memory installed on this machine.
pub fn total_bytes() -> Option<usize> {
    imp::total_bytes()
}

/// Asks the allocator to hand freed memory back to the operating system, so
/// that the measurements reflect live data rather than cached free blocks.
pub fn release_unused() {
    imp::release_unused();
}

#[cfg(target_os = "macos")]
mod imp {
    use core::mem::{MaybeUninit, size_of};

    pub fn resident_bytes() -> Option<usize> {
        let mut info = MaybeUninit::<libc::mach_task_basic_info>::uninit();
        let mut count = libc::MACH_TASK_BASIC_INFO_COUNT;
        // SAFETY: `info` is a writable buffer of `count` integers, exactly what
        // `task_info(MACH_TASK_BASIC_INFO)` fills in. `mach_task_self` is
        // deprecated in `libc` in favour of the `mach2` crate, but it is the
        // same stable kernel call and not worth another dependency.
        #[allow(deprecated)]
        let rc = unsafe {
            libc::task_info(
                libc::mach_task_self(),
                libc::MACH_TASK_BASIC_INFO,
                info.as_mut_ptr().cast::<libc::integer_t>(),
                &mut count,
            )
        };
        if rc != libc::KERN_SUCCESS {
            return None;
        }
        // SAFETY: the kernel filled the struct (checked above).
        let info = unsafe { info.assume_init() };
        Some(info.resident_size as usize)
    }

    fn rusage_info() -> Option<libc::rusage_info_v4> {
        let mut info = MaybeUninit::<libc::rusage_info_v4>::uninit();
        // SAFETY: `RUSAGE_INFO_V4` expects a pointer to a `rusage_info_v4`,
        // passed as a `rusage_info_t` out-pointer.
        let rc = unsafe {
            libc::proc_pid_rusage(
                libc::getpid(),
                libc::RUSAGE_INFO_V4,
                info.as_mut_ptr().cast::<libc::rusage_info_t>(),
            )
        };
        if rc != 0 {
            return None;
        }
        // SAFETY: the call succeeded and initialised the struct.
        Some(unsafe { info.assume_init() })
    }

    pub fn footprint_bytes() -> Option<usize> {
        rusage_info().map(|info| info.ri_phys_footprint as usize)
    }

    pub fn peak_resident_bytes() -> Option<usize> {
        super::rusage_maxrss() // already in bytes on macOS
    }

    unsafe extern "C" {
        /// From `malloc/malloc.h`; not exposed by the `libc` crate.
        fn malloc_zone_pressure_relief(zone: *mut libc::c_void, goal: usize) -> usize;
    }

    pub fn release_unused() {
        // SAFETY: a null zone means "all zones" and a goal of 0 means "as
        // much as possible"; the call has no other preconditions.
        unsafe { malloc_zone_pressure_relief(core::ptr::null_mut(), 0) };
    }

    pub fn total_bytes() -> Option<usize> {
        let mut value: u64 = 0;
        let mut len = size_of::<u64>();
        let name = c"hw.memsize";
        // SAFETY: `value` is a u64 and `len` is its size; sysctlbyname writes
        // at most `len` bytes.
        let rc = unsafe {
            libc::sysctlbyname(
                name.as_ptr(),
                (&mut value as *mut u64).cast(),
                &mut len,
                core::ptr::null_mut(),
                0,
            )
        };
        (rc == 0).then_some(value as usize)
    }
}

#[cfg(target_os = "linux")]
mod imp {
    fn status_field(name: &str) -> Option<usize> {
        let status = std::fs::read_to_string("/proc/self/status").ok()?;
        let line = status.lines().find(|l| l.starts_with(name))?;
        let kb: usize = line.split_whitespace().nth(1)?.parse().ok()?;
        Some(kb * 1024)
    }

    pub fn resident_bytes() -> Option<usize> {
        status_field("VmRSS:")
    }

    pub fn footprint_bytes() -> Option<usize> {
        status_field("RssAnon:").or_else(resident_bytes)
    }

    pub fn peak_resident_bytes() -> Option<usize> {
        super::rusage_maxrss().map(|kb| kb * 1024) // kibibytes on Linux
    }

    pub fn release_unused() {
        // SAFETY: malloc_trim has no preconditions.
        unsafe { libc::malloc_trim(0) };
    }

    pub fn total_bytes() -> Option<usize> {
        let meminfo = std::fs::read_to_string("/proc/meminfo").ok()?;
        let line = meminfo.lines().find(|l| l.starts_with("MemTotal:"))?;
        let kb: usize = line.split_whitespace().nth(1)?.parse().ok()?;
        Some(kb * 1024)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod imp {
    pub fn resident_bytes() -> Option<usize> {
        None
    }
    pub fn footprint_bytes() -> Option<usize> {
        None
    }
    pub fn peak_resident_bytes() -> Option<usize> {
        None
    }
    pub fn total_bytes() -> Option<usize> {
        None
    }
    pub fn release_unused() {}
}

#[cfg(unix)]
fn rusage_maxrss() -> Option<usize> {
    let mut usage = core::mem::MaybeUninit::<libc::rusage>::uninit();
    // SAFETY: `usage` is a valid out-pointer for getrusage.
    let rc = unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) };
    if rc != 0 {
        return None;
    }
    // SAFETY: getrusage succeeded and initialised the struct.
    let usage = unsafe { usage.assume_init() };
    Some(usage.ru_maxrss as usize)
}

#[cfg(test)]
mod tests {
    #[test]
    fn measurements_are_plausible() {
        if let Some(rss) = super::resident_bytes() {
            assert!(rss > 100 * 1024, "rss {rss} too small");
        }
        if let (Some(total), Some(rss)) = (super::total_bytes(), super::resident_bytes()) {
            assert!(total > rss);
        }
    }

    #[test]
    fn measurements_track_allocations() {
        let Some(before) = super::footprint_bytes() else {
            return;
        };
        let block = vec![1u8; 64 << 20];
        let after = super::footprint_bytes().unwrap();
        assert!(
            after >= before + (48 << 20),
            "footprint did not grow: {before} -> {after}"
        );
        assert_eq!(block[block.len() - 1], 1);
    }
}
