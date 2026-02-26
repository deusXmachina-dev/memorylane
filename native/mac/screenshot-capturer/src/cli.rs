use std::env;
use std::path::PathBuf;

#[derive(Debug)]
pub(crate) struct Config {
    pub(crate) output_dir: PathBuf,
    pub(crate) interval_ms: u64,
}

pub(crate) fn parse_args() -> Result<Config, String> {
    let mut output_dir: Option<PathBuf> = None;
    let mut interval_ms: u64 = 1000;

    let args = env::args().skip(1).collect::<Vec<_>>();
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "--output-dir" => {
                i += 1;
                if i >= args.len() {
                    return Err("Missing value for --output-dir".to_string());
                }
                output_dir = Some(PathBuf::from(&args[i]));
            }
            "--interval-ms" => {
                i += 1;
                if i >= args.len() {
                    return Err("Missing value for --interval-ms".to_string());
                }
                interval_ms = args[i]
                    .parse::<u64>()
                    .map_err(|_| format!("Invalid --interval-ms value: {}", args[i]))?;
                if interval_ms == 0 {
                    return Err("--interval-ms must be greater than 0".to_string());
                }
            }
            unknown => return Err(format!("Unknown argument: {unknown}")),
        }
        i += 1;
    }

    let output_dir = output_dir.ok_or_else(|| "Missing required --output-dir".to_string())?;
    Ok(Config {
        output_dir,
        interval_ms,
    })
}
