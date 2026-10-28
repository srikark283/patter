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
    let styling: String?
    let structure: String?
    let context: String?
    let instruction: String?
}
struct InferenceError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
let systemPrompt = "You are a text normalizer for speech-to-text transcripts. The input begins with a control line specifying the styling, structure, and context settings; clean the transcript to match those settings and output only the cleaned text."

@main
struct PatterS1 {
    static func main() async {
        guard (2...3).contains(CommandLine.arguments.count),
            CommandLine.arguments.count == 2 || ["s1_mini", "patter_flash"].contains(CommandLine.arguments[2]) else {
            emit(["error": "Expected a local built-in model directory"]); return
        }
        let flash = CommandLine.arguments.count == 3 && CommandLine.arguments[2] == "patter_flash"
        let name = flash ? "Patter Flash" : "S1-mini by Superwhisper"
        // Flash was fine-tuned with a 1,024-token prompt-and-answer limit.
        let budget = flash ? 256 : 384
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
                    if flash {
                        guard let instruction = request.instruction, !instruction.isEmpty,
                            instruction.utf8.count <= 16000 else {
                            throw InferenceError(message: "Invalid Patter Flash instruction")
                        }
                    } else {
                        guard ["casual", "semi-casual", "semi-formal", "formal"].contains(request.styling ?? ""),
                            ["prose", "lists"].contains(request.structure ?? ""),
                            ["general", "email"].contains(request.context ?? "") else {
                            throw InferenceError(message: "Invalid S1-mini controls")
                        }
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
                        let messages: [[String: String]]
                        if flash {
                            messages = try flashMessages(text: chunk, instruction: request.instruction!)
                        } else {
                            let control = "[Styling: \(request.styling!)] [Structure: \(request.structure!)] [Context: \(request.context!)]"
                            messages = [
                                ["role": "system", "content": systemPrompt],
                                ["role": "user", "content": control + "\n" + chunk]
                            ]
                        }
                        let input = try await model.prepare(input: UserInput(messages: messages,
                            additionalContext: ["enable_thinking": false]))
                        let limit = flash ? max(128, count * 2 + 128) : max(64, Int(Double(count) * 1.5) + 64)
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
