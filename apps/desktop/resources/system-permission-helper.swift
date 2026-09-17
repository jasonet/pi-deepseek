import Foundation
import Cocoa
import CoreGraphics
import ApplicationServices

struct PermissionStatus: Encodable {
    let accessibility: String
    let screenRecording: String
}

func checkAccessibility() -> Bool {
    return AXIsProcessTrusted()
}

func requestAccessibility(prompt: Bool = true) -> Bool {
    let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    let options = [key: prompt] as CFDictionary
    return AXIsProcessTrustedWithOptions(options)
}

func checkScreenRecording() -> Bool {
    if #available(macOS 10.15, *) {
        return CGPreflightScreenCaptureAccess()
    }
    return true
}

func requestScreenRecording() -> Bool {
    if #available(macOS 10.15, *) {
        if CGPreflightScreenCaptureAccess() {
            return true
        }
        return CGRequestScreenCaptureAccess()
    }
    return true
}

func openSystemSettings(urlScheme: String) {
    if let url = URL(string: urlScheme) {
        NSWorkspace.shared.open(url)
    }
}

func openAccessibilitySettings() {
    let urls = [
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility"
    ]
    for urlStr in urls {
        if let url = URL(string: urlStr), NSWorkspace.shared.open(url) {
            return
        }
    }
}

func openScreenRecordingSettings() {
    let urls = [
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture"
    ]
    for urlStr in urls {
        if let url = URL(string: urlStr), NSWorkspace.shared.open(url) {
            return
        }
    }
}

func emitStatus() -> Never {
    let status = PermissionStatus(
        accessibility: checkAccessibility() ? "granted" : "denied",
        screenRecording: checkScreenRecording() ? "granted" : "denied"
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    if let data = try? encoder.encode(status) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }
    exit(EXIT_SUCCESS)
}

let args = CommandLine.arguments

if args.contains("--request-accessibility") {
    _ = requestAccessibility(prompt: true)
    if !checkAccessibility() {
        openAccessibilitySettings()
    }
    emitStatus()
} else if args.contains("--request-screen-recording") {
    _ = requestScreenRecording()
    if !checkScreenRecording() {
        openScreenRecordingSettings()
    }
    emitStatus()
} else if args.contains("--request-all") {
    var neededOpenSettings = false
    if !checkAccessibility() {
        _ = requestAccessibility(prompt: true)
        neededOpenSettings = true
    }
    if !checkScreenRecording() {
        _ = requestScreenRecording()
        neededOpenSettings = true
    }
    if neededOpenSettings {
        // Prefer opening Accessibility settings as primary guidance
        openAccessibilitySettings()
    }
    emitStatus()
} else if args.contains("--open-accessibility-settings") {
    openAccessibilitySettings()
    emitStatus()
} else if args.contains("--open-screen-recording-settings") {
    openScreenRecordingSettings()
    emitStatus()
} else {
    // Default: Check status without disturbing user
    emitStatus()
}
