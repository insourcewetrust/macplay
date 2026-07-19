// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "MacPlay",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "MacPlay", path: "Sources/MacPlay")
    ]
)
