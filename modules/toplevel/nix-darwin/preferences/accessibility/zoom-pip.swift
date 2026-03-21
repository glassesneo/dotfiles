import Foundation
import AppKit

let size = NSSize(width: @pipWidth@, height: @pipHeight@)
let data = try NSKeyedArchiver.archivedData(
  withRootObject: NSValue(size: size),
  requiringSecureCoding: false
)

let path = NSString(string: "~/Library/Preferences/com.apple.universalaccess.plist").expandingTildeInPath
let url = URL(fileURLWithPath: path)

let plistData = try Data(contentsOf: url)
var format = PropertyListSerialization.PropertyListFormat.binary
var plist = try PropertyListSerialization.propertyList(from: plistData, options: [], format: &format) as! [String: Any]

plist["closeViewWindowSize"] = data

let out = try PropertyListSerialization.data(fromPropertyList: plist, format: format, options: 0)
try out.write(to: url)
