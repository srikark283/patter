import Foundation

@main
struct ChunkingCheck {
    static func main() {
for text in ["One sentence. Another sentence! Last sentence?", String(repeating: "unpunctuated words ", count: 300), String(repeating: "你好世界 👩🏽‍💻 ", count: 70), "", "singleword", String(repeating: "x", count: 130)] {
    let chunks = transcriptChunks(text, budget: 30) { $0.count }
    assert(chunks.joined() == text, "Chunking must not drop or repeat characters")
    assert(chunks.allSatisfy { $0.count <= 30 }, "Every chunk must fit the budget")
}
let sentences = transcriptChunks("First sentence. Second sentence. Third sentence.", budget: 32) { $0.count }
assert(sentences.first == "First sentence. Second sentence.")
print("Chunking checks passed: sentence boundaries, unpunctuated text, Unicode, empty input, and exact preservation.")

    }
}
