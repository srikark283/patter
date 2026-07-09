import { MessagesSquare } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Card } from "@/components/ui/card";

export function MeetingsView() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">
      <PageHeader title="Meetings" description="Record and transcribe full conversations." />
      
      <Card className="flex flex-col items-center justify-center py-20 px-4 text-center border-dashed bg-white/[0.01]">
        <div className="w-12 h-12 rounded-xl bg-white/[0.04] ring-1 ring-border flex items-center justify-center mb-4">
          <MessagesSquare className="text-muted-foreground" size={24} />
        </div>
        <h3 className="text-lg font-medium text-foreground">Meetings (Coming Soon)</h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-[280px]">
          We're working on bringing long-form conversation recording with speaker diarization. Stay tuned!
        </p>
      </Card>
    </div>
  );
}
