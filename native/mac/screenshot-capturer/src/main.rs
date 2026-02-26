mod ax_focus;
mod capture;
mod cli;
mod display;
mod events;
mod run_loop;
mod types;

use cli::parse_args;
use events::emit_error_event;
use run_loop::run;

fn main() {
    let config = match parse_args() {
        Ok(config) => config,
        Err(err) => {
            emit_error_event(&err);
            std::process::exit(2);
        }
    };

    if let Err(err) = run(config) {
        emit_error_event(&err);
        std::process::exit(1);
    }
}
