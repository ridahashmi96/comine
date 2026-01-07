use std::sync::{Mutex, MutexGuard};

pub fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            log::error!("Mutex was poisoned by a panicked thread, recovering");
            poisoned.into_inner()
        }
    }
}

#[cfg(target_os = "windows")]
pub trait CommandHideConsole {
    fn hide_console(&mut self) -> &mut Self;
}

#[cfg(target_os = "windows")]
impl CommandHideConsole for tokio::process::Command {
    fn hide_console(&mut self) -> &mut Self {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        self.creation_flags(CREATE_NO_WINDOW);
        self
    }
}

#[cfg(target_os = "windows")]
pub trait StdCommandHideConsole {
    fn hide_console(&mut self) -> &mut Self;
}

#[cfg(target_os = "windows")]
impl StdCommandHideConsole for std::process::Command {
    fn hide_console(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        self.creation_flags(CREATE_NO_WINDOW);
        self
    }
}
