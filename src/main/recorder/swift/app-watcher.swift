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

func focusedWindowFrame(forPid pid: pid_t) -> CGRect? {
    guard let win = focusedWindow(forPid: pid) else { return nil }

    var positionValue: AnyObject?
    var sizeValue: AnyObject?
    guard AXUIElementCopyAttributeValue(win, kAXPositionAttribute as CFString, &positionValue) == .success,
          AXUIElementCopyAttributeValue(win, kAXSizeAttribute as CFString, &sizeValue) == .success,
          let positionObject = positionValue,
          let sizeObject = sizeValue,
          CFGetTypeID(positionObject) == AXValueGetTypeID(),
          CFGetTypeID(sizeObject) == AXValueGetTypeID() else {
        return nil
    }

    let positionAX = positionObject as! AXValue
    let sizeAX = sizeObject as! AXValue
    guard AXValueGetType(positionAX) == .cgPoint,
          AXValueGetType(sizeAX) == .cgSize else {
        return nil
    }

    var origin = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(positionAX, .cgPoint, &origin),
          AXValueGetValue(sizeAX, .cgSize, &size) else {
        return nil
    }

    return CGRect(origin: origin, size: size)
}

func displayIdForWindowFrame(_ frame: CGRect) -> CGDirectDisplayID? {
    let screens = NSScreen.screens
    guard !screens.isEmpty else {
        return nil
    }

    let center = CGPoint(x: frame.midX, y: frame.midY)
    if let centerScreen = screens.first(where: { $0.frame.contains(center) }),
       let screenNumber = centerScreen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber {
        return CGDirectDisplayID(screenNumber.uint32Value)
    }

    var bestScreen: NSScreen?
    var bestArea: CGFloat = 0
    for screen in screens {
        let intersection = frame.intersection(screen.frame)
        if intersection.isNull {
            continue
        }

        let area = intersection.width * intersection.height
        if area > bestArea {
            bestArea = area
            bestScreen = screen
        }
    }

    guard let bestScreen,
          let screenNumber = bestScreen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
        return nil
    }

    return CGDirectDisplayID(screenNumber.uint32Value)
}

// MARK: - Browser URL via Accessibility API

let browserBundleIds: Set<String> = [
    "com.google.Chrome",
    "com.google.Chrome.canary",
    "org.chromium.Chromium",
    "com.brave.Browser",
    "com.microsoft.edgemac",
    "com.vivaldi.Vivaldi",
    "company.thebrowser.Browser",  // Arc
    "com.operasoftware.Opera",
    "com.apple.Safari",
    "com.apple.SafariTechnologyPreview",
]

/// Try the AXDocument attribute on the window — supported by Safari and Chrome-family.
func axDocumentURL(window: AXUIElement) -> String? {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(window, "AXDocument" as CFString, &value) == .success else {
        return nil
    }
    guard let url = value as? String, !url.isEmpty, url != "about:blank" else { return nil }
    return url
}

/// BFS through the AX tree to find an address-bar text field by its identifier.
/// Depth-limited to avoid hanging on deeply nested UIs.
func findAddressBarValue(in element: AXUIElement, depth: Int = 0) -> String? {
    guard depth < 6 else { return nil }

    var role: AnyObject?
    var identifier: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)
    AXUIElementCopyAttributeValue(element, kAXIdentifierAttribute as CFString, &identifier)

    if let r = role as? String, r == kAXTextFieldRole as String,
       let id = identifier as? String,
       id.lowercased().contains("address") || id.lowercased().contains("url") || id.lowercased().contains("location") {
        var value: AnyObject?
        if AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &value) == .success,
           let urlStr = value as? String, !urlStr.isEmpty {
            return urlStr
        }
    }

    var children: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success,
          let childArray = children as? [AXUIElement] else { return nil }

    for child in childArray {
        if let url = findAddressBarValue(in: child, depth: depth + 1) { return url }
    }
    return nil
}

/// Extract the current URL from a browser window using the Accessibility API only.
/// No AppleScript — relies solely on the Accessibility permission already required by this process.
func browserURL(pid: pid_t, bundleId: String) -> String? {
    guard browserBundleIds.contains(bundleId) else { return nil }
    guard let window = focusedWindow(forPid: pid) else { return nil }

    // AXDocument is the fast path — one attribute read, works for Safari and Chrome-family.
    if let url = axDocumentURL(window: window) { return url }

    // Fall back to searching the AX tree for the address bar text field.
    return findAddressBarValue(in: window)
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

    if let url = browserURL(pid: pid, bundleId: bundleId) {
        dict["url"] = url
    }

    if let frame = focusedWindowFrame(forPid: pid) {
        dict["windowBounds"] = [
            "x": frame.origin.x,
            "y": frame.origin.y,
            "width": frame.size.width,
            "height": frame.size.height,
        ]
        if let displayId = displayIdForWindowFrame(frame) {
            dict["displayId"] = Int(displayId)
        }
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
