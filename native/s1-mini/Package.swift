// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PatterS1",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "patter-intelligence", targets: ["PatterS1"])],
    dependencies: [
        .package(url: "https://github.com/ml-explore/mlx-swift-lm", exact: "2.30.6"),
    ],
    targets: [
        .executableTarget(name: "PatterS1", dependencies: [
            .product(name: "MLXLLM", package: "mlx-swift-lm"),
            .product(name: "MLXLMCommon", package: "mlx-swift-lm"),
        ])
    ]
)
