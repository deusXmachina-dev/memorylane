import Cocoa

// Flush stdout after every write
setbuf(stdout, nil)

// MARK: - Helpers

/// Emit a JSON event to stdout (one per line).
func emit(_ dict: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: dict),
          let json = String(data: data, encoding: .utf8) else { return }
    print(json)
}

func nowMs() -> Int64 {
    return Int64(Date().timeIntervalSince1970 * 1000)
}

/// Escape a string for safe embedding inside an AppleScript string literal.
func escapeForAppleScript(_ s: String) -> String {
    return s.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
}

// MARK: - Accessibility helpers

/// Read the focused window's AXUIElement for a given PID.
func focusedWindow(forPid pid: pid_t) -> AXUIElement? {
    let appElement = AXUIElementCreateApplication(pid)
    var window: AnyObject?
    guard AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &window) == .success else {
        return nil
    }
    return (window as! AXUIElement)
}

/// Read the focused window title for a given PID via Accessibility API.
func windowTitle(forPid pid: pid_t) -> String? {
    guard let win = focusedWindow(forPid: pid) else { return nil }
    var titleValue: AnyObject?
    guard AXUIElementCopyAttributeValue(win, kAXTitleAttribute as CFString, &titleValue) == .success else {
        return nil
    }
    return titleValue as? String
}

// MARK: - Browser URL extraction via AppleScript

/// Bundle IDs we know how to extract URLs from.
let chromiumBundleIds: Set<String> = [
    "com.google.Chrome",
    "com.google.Chrome.canary",
    "com.brave.Browser",
    "com.microsoft.edgemac",
    "com.vivaldi.Vivaldi",
    "company.thebrowser.Browser",  // Arc
    "com.operasoftware.Opera",
]

/// Get the active tab URL from a Chromium-based browser via AppleScript.
func chromiumTabURL(appName: String) -> String? {
    let escaped = escapeForAppleScript(appName)
    let src = "tell application \"\(escaped)\" to get URL of active tab of front window"
    var error: NSDictionary?
    guard let script = NSAppleScript(source: src) else { return nil }
    let result = script.executeAndReturnError(&error)
    if error != nil { return nil }
    return result.stringValue
}

/// Get the active tab URL from Safari.
func safariTabURL() -> String? {
    let src = "tell application \"Safari\" to get URL of front document"
    var error: NSDictionary?
    guard let script = NSAppleScript(source: src) else { return nil }
    let result = script.executeAndReturnError(&error)
    if error != nil { return nil }
    return result.stringValue
}

/// Attempt to extract a URL for the given app. Returns nil if not a known browser or on failure.
func browserURL(bundleId: String, appName: String) -> String? {
    if chromiumBundleIds.contains(bundleId) {
        return chromiumTabURL(appName: appName)
    }
    if bundleId == "com.apple.Safari" || bundleId == "com.apple.SafariTechnologyPreview" {
        return safariTabURL()
    }
    return nil
}

// MARK: - Build event payload

/// Build the full event dictionary, enriching with url/document where possible.
func buildEvent(type: String, app: NSRunningApplication, title: String) -> [String: Any] {
    let bundleId = app.bundleIdentifier ?? ""
    let appName = app.localizedName ?? ""
    let pid = app.processIdentifier

    var dict: [String: Any] = [
        "type": type,
        "timestamp": nowMs(),
        "app": appName,
        "bundleId": bundleId,
        "pid": pid,
        "title": title,
    ]

    // Try to get browser URL
    if let url = browserURL(bundleId: bundleId, appName: appName) {
        dict["url"] = url
    }

    return dict
}

// MARK: - AXObserver for focused-window changes within an app

var currentAXObserver: AXObserver?
var currentObservedPid: pid_t = 0

var titleAXObserver: AXObserver?
var titleObservedPid: pid_t = 0
var titleObservedWindow: AXUIElement?

func tearDownAXObserver() {
    if let observer = currentAXObserver {
        CFRunLoopRemoveSource(CFRunLoopGetMain(),
                              AXObserverGetRunLoopSource(observer),
                              .defaultMode)
        currentAXObserver = nil
        currentObservedPid = 0
    }
}

// MARK: - AXObserver for title changes (browser tab switches)

func tearDownTitleObserver() {
    if let observer = titleAXObserver {
        if let window = titleObservedWindow {
            AXObserverRemoveNotification(observer, window,
                                         kAXTitleChangedNotification as CFString)
        }
        CFRunLoopRemoveSource(CFRunLoopGetMain(),
                              AXObserverGetRunLoopSource(observer),
                              .defaultMode)
        titleAXObserver = nil
        titleObservedPid = 0
        titleObservedWindow = nil
    }
}

/// Callback fired when the focused window's title changes (e.g. browser tab switch).
let titleCallback: AXObserverCallback = { _, element, _, _ in
    guard let app = NSWorkspace.shared.frontmostApplication else { return }

    var titleValue: AnyObject?
    let title: String
    if AXUIElementCopyAttributeValue(element, kAXTitleAttribute as CFString, &titleValue) == .success,
       let t = titleValue as? String {
        title = t
    } else {
        title = ""
    }

    emit(buildEvent(type: "window_change", app: app, title: title))
}

func setupTitleObserver(forPid pid: pid_t) {
    tearDownTitleObserver()

    guard let window = focusedWindow(forPid: pid) else { return }

    var observer: AXObserver?
    guard AXObserverCreate(pid, titleCallback, &observer) == .success,
          let obs = observer else { return }

    AXObserverAddNotification(obs, window,
                              kAXTitleChangedNotification as CFString,
                              nil)

    CFRunLoopAddSource(CFRunLoopGetMain(),
                       AXObserverGetRunLoopSource(obs),
                       .defaultMode)

    titleAXObserver = obs
    titleObservedPid = pid
    titleObservedWindow = window
}

/// Callback fired when the focused window changes within the observed app.
let axCallback: AXObserverCallback = { _, element, _, _ in
    guard let app = NSWorkspace.shared.frontmostApplication else { return }

    var titleValue: AnyObject?
    let title: String
    if AXUIElementCopyAttributeValue(element, kAXTitleAttribute as CFString, &titleValue) == .success,
       let t = titleValue as? String {
        title = t
    } else {
        title = windowTitle(forPid: app.processIdentifier) ?? ""
    }

    emit(buildEvent(type: "window_change", app: app, title: title))

    // Re-target title observer to the newly focused window
    setupTitleObserver(forPid: app.processIdentifier)
}

func setupAXObserver(forPid pid: pid_t) {
    tearDownAXObserver()
    tearDownTitleObserver()

    var observer: AXObserver?
    guard AXObserverCreate(pid, axCallback, &observer) == .success,
          let obs = observer else { return }

    let appElement = AXUIElementCreateApplication(pid)
    AXObserverAddNotification(obs, appElement,
                              kAXFocusedWindowChangedNotification as CFString,
                              nil)

    CFRunLoopAddSource(CFRunLoopGetMain(),
                       AXObserverGetRunLoopSource(obs),
                       .defaultMode)

    currentAXObserver = obs
    currentObservedPid = pid

    // Also observe title changes on the focused window (for browser tab switches)
    setupTitleObserver(forPid: pid)
}

// MARK: - NSWorkspace notifications

let nc = NSWorkspace.shared.notificationCenter

nc.addObserver(forName: NSWorkspace.didActivateApplicationNotification,
               object: nil, queue: .main) { notification in
    guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }

    let title = windowTitle(forPid: app.processIdentifier) ?? ""
    emit(buildEvent(type: "app_change", app: app, title: title))

    // Set up AX observer for window changes within this new app
    setupAXObserver(forPid: app.processIdentifier)
}

// MARK: - Ready

// Set up AX observer for the currently frontmost app at launch
if let frontmost = NSWorkspace.shared.frontmostApplication {
    setupAXObserver(forPid: frontmost.processIdentifier)
}

emit([
    "type": "ready",
    "timestamp": nowMs(),
])

// Keep the process alive
RunLoop.main.run()
