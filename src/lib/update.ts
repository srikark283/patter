import { toast } from "sonner";
import { installUpdate, restartApp } from "./ipc";

/** Offer an available update: user consents to download, then to restart. */
export function promptUpdateInstall(version: string) {
  toast.info(`Patter ${version} is available`, {
    id: "update",
    description: "Downloads from GitHub and applies on restart.",
    duration: Infinity,
    action: {
      label: "Download & Install",
      onClick: async () => {
        toast.loading(`Downloading Patter ${version}…`, { id: "update", duration: Infinity });
        try {
          await installUpdate();
          toast.success(`Patter ${version} installed`, {
            id: "update",
            description: "Takes effect after a restart.",
            duration: Infinity,
            action: { label: "Restart now", onClick: () => restartApp() },
          });
        } catch (e) {
          toast.error(`Update failed: ${e}`, { id: "update" });
        }
      },
    },
  });
}
