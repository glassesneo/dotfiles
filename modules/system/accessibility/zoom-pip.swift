import AppKit
import Foundation
import ObjectiveC

func fail(_ message: String, status: Int32 = 1) -> Never {
  fputs("\(message)\n", stderr)
  exit(status)
}

guard CommandLine.arguments.count == 3,
      let width = Double(CommandLine.arguments[1]), width > 0,
      let height = Double(CommandLine.arguments[2]), height > 0
else {
  fail("usage: zoom-pip.swift WIDTH HEIGHT", status: 2)
}

let wanted = CGSize(width: width, height: height)
let loaded = Bundle(
  path: "/System/Library/PrivateFrameworks/UniversalAccess.framework"
)?.load() ?? false
guard loaded, let settingsClass = NSClassFromString("UAZoomSettings") else {
  fail("UAZoomSettings is unavailable")
}

guard let settings = (settingsClass as AnyObject)
  .perform(NSSelectorFromString("shared"))?
  .takeUnretainedValue()
else {
  fail("UAZoomSettings.shared is unavailable")
}

typealias SizeGetter = @convention(c) (AnyObject, Selector) -> CGSize
typealias SizeSetter = @convention(c) (AnyObject, Selector, CGSize) -> Void
let getSel = NSSelectorFromString("zoomWindowSize")
let setSel = NSSelectorFromString("setZoomWindowSize:")
guard let getterIMP = class_getMethodImplementation(object_getClass(settings), getSel),
      let setterIMP = class_getMethodImplementation(object_getClass(settings), setSel)
else {
  fail("UAZoomSettings zoomWindowSize accessors are unavailable")
}

let getter = unsafeBitCast(getterIMP, to: SizeGetter.self)
let setter = unsafeBitCast(setterIMP, to: SizeSetter.self)
setter(settings, setSel, wanted)

let applied = getter(settings, getSel)
guard applied.width == wanted.width, applied.height == wanted.height else {
  fail("expected \(wanted.width)x\(wanted.height) got \(applied.width)x\(applied.height)")
}

print("applied closeViewWindowSize \(Int(applied.width))x\(Int(applied.height))")
