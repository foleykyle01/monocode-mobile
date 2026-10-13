import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count == 3 else {
    fatalError("Expected generated icon directory and Xcode icon catalog directory")
}
let source = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let target = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
let files = try FileManager.default.contentsOfDirectory(at: source, includingPropertiesForKeys: nil)
    .filter { $0.pathExtension.lowercased() == "png" }
guard !files.isEmpty else { fatalError("No generated iOS icons found") }
for file in files {
    guard let input = CGImageSourceCreateWithURL(file as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(input, 0, nil),
          let context = CGContext(data: nil, width: image.width, height: image.height,
              bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
        fatalError("Cannot decode generated iOS icon")
    }
    let bounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
    context.setFillColor(CGColor(red: 23.0 / 255, green: 87.0 / 255, blue: 194.0 / 255, alpha: 1))
    context.fill(bounds)
    context.draw(image, in: bounds)
    let output = target.appendingPathComponent(file.lastPathComponent)
    guard let opaque = context.makeImage(),
          let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        fatalError("Cannot encode opaque iOS icon")
    }
    CGImageDestinationAddImage(destination, opaque, nil)
    guard CGImageDestinationFinalize(destination),
          let check = CGImageSourceCreateWithURL(output as CFURL, nil),
          let decoded = CGImageSourceCreateImageAtIndex(check, 0, nil),
          [CGImageAlphaInfo.none, .noneSkipFirst, .noneSkipLast].contains(decoded.alphaInfo),
          decoded.width == image.width, decoded.height == image.height else {
        fatalError("iOS icon must retain its dimensions and have no alpha channel")
    }
}
print("Verified \(files.count) opaque iOS icons")
