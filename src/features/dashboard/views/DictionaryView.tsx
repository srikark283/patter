import { invoke } from "@tauri-apps/api/core";

interface Props {
  customPrompt: string;
  setCustomPrompt: (prompt: string) => void;
}

export function DictionaryView({ customPrompt, setCustomPrompt }: Props) {
  const handleSetCustomPrompt = async (prompt: string) => {
    try {
      await invoke("set_custom_prompt", { prompt });
      setCustomPrompt(prompt);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h2 className="text-2xl font-bold">Dictionary & Rules</h2>
      
      <div className="bg-[#1a1a1a] rounded-xl border border-[#2a2a2a] p-6">
        <h3 className="text-lg font-semibold mb-2">Custom Vocabulary & Prompt Injection</h3>
        <p className="text-sm text-gray-400 mb-6 leading-relaxed">
          Guide the model's transcription by providing a list of specific names, industry jargon, or formatting examples. 
          <br/><br/>
          For example: <i>"My name is Srikar. I use Tauri, React, and Rust. Always capitalize Apple."</i>
        </p>
        <textarea
          value={customPrompt}
          onChange={(e) => handleSetCustomPrompt(e.target.value)}
          placeholder="Enter your custom vocabulary here..."
          className="w-full bg-[#111111] border border-[#2a2a2a] rounded-lg p-4 text-sm text-gray-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors placeholder:text-gray-600"
          rows={5}
        />
      </div>
    </div>
  );
}
