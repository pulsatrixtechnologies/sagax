/** Isolated gallery for a GIF in a room: a GIF the person sent (the bubble
 * hugs the media, flush right) and a bot line whose text ends with a bare GIF
 * URL (drawn as the animated image, text kept above). The real
 * RoomTextMessage. Not shipped in the app. ?skin=<id>&lang=<code> */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { RoomTextMessage } from "../components/GroupView.tsx-parts/RoomTextMessage";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot, type Group, type Message } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const bot = { id: "pepper", threadId: "t1", name: "Pepper", title: "Pepper", description: "", notifications: false, color: "green", unread: false, messages: [] } as unknown as Bot;
const group = { id: "g1", threadId: "gt1", name: "Room", memberIds: ["pepper"], humanIds: ["me"], defaultResponder: "all", bulletin: "", unread: false, createdAt: 1 } as unknown as Group;
const mine: Message = {
  id: "m1", role: "user", kind: "text", at: 1,
  text: '<attached-image path="/x/3f2b8c1e-5d4a-4b7e-9c1a-2e6f7a8b9c0d.gif" name="cat.gif" meme-provider="giphy" meme-attribution="Via GIPHY" />',
};
const reply: Message = {
  id: "m2", role: "bot", kind: "text", at: 2, from: { botId: "pepper" },
  text: "Here is a little wave for you.\n\nhttps://media3.giphy.com/media/abc123/giphy.gif",
} as Message;

function Ready({ children }: { children: React.ReactNode }) {
  const { dispatch } = useStore();
  useEffect(() => { dispatch({ type: "routinesHydrated", routines: [], runs: [] }); }, [dispatch]);
  return <>{children}</>;
}

function Row({ message, isMine }: { message: Message; isMine: boolean }) {
  return (
    <RoomTextMessage
      group={group} message={message} members={[bot]} mentionPeers={[]} transcript={[]}
      emerging={false} eager mine={isMine} joinsAbove={false} joinsBelow={false}
      onReply={() => {}} reactionSelf={["me"]}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider><Ready>
      <main data-gallery="" className="flex w-[720px] flex-col gap-3 bg-app p-4 text-ink">
        <div data-row="mine"><Row message={mine} isMine /></div>
        <div data-row="bot"><Row message={reply} isMine={false} /></div>
      </main>
    </Ready></StoreProvider>
  </StrictMode>,
);
