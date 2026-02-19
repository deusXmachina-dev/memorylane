import Cocoa

setbuf(stdout, nil)
setbuf(stderr, nil)

let args = Array(CommandLine.arguments.dropFirst())
let title = args.indices.contains(0) ? args[0] : "MemoryLane Integration Window"
let lifetimeSeconds = args.indices.contains(1) ? (Double(args[1]) ?? 20.0) : 20.0

let app = NSApplication.shared
app.setActivationPolicy(.regular)

let window = NSWindow(
    contentRect: NSRect(x: 160, y: 180, width: 720, height: 440),
    styleMask: [.titled, .closable, .resizable],
    backing: .buffered,
    defer: false
)
window.title = title
window.makeKeyAndOrderFront(nil)
NSApp.activate(ignoringOtherApps: true)

print("READY:\(title)")

let endTime = Date().addingTimeInterval(lifetimeSeconds)
while Date() < endTime {
    RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
}

window.close()
