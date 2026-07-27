// Interrupting a script that has loaded onnxruntime aborts (SIGABRT) in the C++
// static destructors, which files a macOS crash report for what is just a
// cancelled run. SIGKILL skips that teardown entirely.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => process.kill(process.pid, 'SIGKILL'))
}
