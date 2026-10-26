import Foundation

// Keep every character, prefer sentence boundaries, and bound each chunk using
// the loaded model's tokenizer (including punctuation-free and Unicode input).
func transcriptChunks(_ text: String, budget: Int, tokenCount: (String) -> Int) -> [String] {
    precondition(budget > 0)
    var remaining = text
    var chunks: [String] = []
    while !remaining.isEmpty {
        if tokenCount(remaining) <= budget { chunks.append(remaining); break }
        let indices = Array(remaining.indices) + [remaining.endIndex]
        var low = 1
        var high = indices.count - 1
        while low < high {
            let mid = (low + high + 1) / 2
            if tokenCount(String(remaining[..<indices[mid]])) <= budget { low = mid }
            else { high = mid - 1 }
        }
        while low > 1 && tokenCount(String(remaining[..<indices[low]])) > budget { low -= 1 }
        let floor = max(1, low / 2)
        let sentence = (floor...low).reversed().first { i in
            i < indices.count - 1 && ".!?\n".contains(remaining[indices[i - 1]]) && remaining[indices[i]].isWhitespace
        }
        let word = (floor...low).reversed().first { $0 < indices.count - 1 && remaining[indices[$0]].isWhitespace }
        let end = indices[sentence ?? word ?? low]
        chunks.append(String(remaining[..<end]))
        remaining = String(remaining[end...])
    }
    return chunks
}
