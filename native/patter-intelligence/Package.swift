// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PatterIntelligence",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "patter-intelligence", targets: ["PatterIntelligence"])],
    dependencies: [
        .package(url: "https://github.com/ml-explore/mlx-swift-lm", exact: "2.30.6"),
    ],
    targets: [
        .executableTarget(name: "PatterIntelligence", dependencies: [
            .product(name: "MLXLLM", package: "mlx-swift-lm"),
            .product(name: "MLXLMCommon", package: "mlx-swift-lm"),
        ])
    ]
)
