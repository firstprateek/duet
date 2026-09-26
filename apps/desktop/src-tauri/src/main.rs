// Keeps a release build from opening a console window on Windows. Duet targets macOS.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    duet_lib::run()
}
