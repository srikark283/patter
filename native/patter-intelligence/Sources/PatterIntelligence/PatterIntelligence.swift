import Foundation
import MLXLLM
import MLXLMCommon

// stdout is a private JSON-lines protocol to the parent, never a network service.
func emit(_ event: [String: String]) {
    let data = try! JSONSerialization.data(withJSONObject: event, options: [.sortedKeys])
    FileHandle.standardOutput.write(data + Data([10]))
}
struct Request: Decodable, Sendable {
    let text: String
    let instruction: String?
}
struct InferenceError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
@main
struct PatterIntelligence {
    static func main() async {
        guard CommandLine.arguments.count == 3,
            ["patter-1-nano", "patter-1-mini"].contains(CommandLine.arguments[2]) else {
            emit(["error": "Expected a Patter model directory and model ID"]); return
        }
        let mini = CommandLine.arguments[2] == "patter-1-mini"
        let name = CommandLine.arguments[2]
        let budget = 256
        do {
            let model = try await LLMModelFactory.shared.loadContainer(
                configuration: ModelConfiguration(directory: URL(fileURLWithPath: CommandLine.arguments[1])))
            emit(["ready": name])
            while let line = readLine() {
                do {
                    let request = try JSONDecoder().decode(Request.self, from: Data(line.utf8))
                    guard request.text.utf8.count <= 128000 else {
                        throw InferenceError(message: "Transcript exceeds the 128 KB input limit")
                    }
                    guard let instruction = request.instruction, !instruction.isEmpty,
                        instruction.utf8.count <= 16000 else {
                        throw InferenceError(message: "Invalid Patter model instruction")
                    }
                    let chunks = await model.perform { context in
                        transcriptChunks(request.text, budget: budget) { context.tokenizer.encode(text: $0).count }
                    }
                    emit(["chunks": String(chunks.count)])
                    var completed = ""
                    for chunk in chunks {
                        let count = await model.perform { $0.tokenizer.encode(text: chunk).count }
                        guard count <= budget else {
                            throw InferenceError(message: "A transcript character exceeds the chunk token budget")
                        }
                        let messages = try nanoMessages(text: chunk, instruction: instruction, separateSystem: mini)
                        let input = try await model.prepare(input: UserInput(messages: messages,
                            additionalContext: ["enable_thinking": false]))
                        let limit = max(128, count * 2 + 128)
                        let stream = try await model.generate(input: input,
                            parameters: GenerateParameters(maxTokens: limit, temperature: 0))
                        var output = ""
                        var finished = false
                        let prefix = completed.isEmpty ? "" : completed + "\n\n"
                        for await event in stream {
                            switch event {
                            case .chunk(let text):
                                output += text; emit(["partial": prefix + output])
                            case .info(let info):
                                switch info.stopReason {
                                case .stop: finished = true
                                case .length:
                                    throw InferenceError(message: "Cleanup output was truncated; keeping the original transcript")
                                case .cancelled:
                                    // MLX 2.x can report an exhausted iterator as cancelled.
                                    throw InferenceError(message: info.generationTokenCount >= limit
                                        ? "Cleanup output was truncated; keeping the original transcript"
                                        : "Cleanup generation cancelled")
                                }
                            case .toolCall: break
                            }
                        }
                        guard finished else { throw InferenceError(message: "Cleanup ended before completion") }
                        let cleaned = output.trimmingCharacters(in: .whitespacesAndNewlines)
                        if !cleaned.isEmpty { completed = prefix + cleaned }
                    }
                    emit(["done": completed])
                } catch { emit(["error": error.localizedDescription]) }
            }
        } catch { emit(["error": "Could not load \(name): \(error.localizedDescription)"]) }
    }
}
