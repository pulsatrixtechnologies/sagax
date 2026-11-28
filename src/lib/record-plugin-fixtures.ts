// The stand-in console of the record windows of the other plugins, for their
// gallery (src/gallery/record-window-plugins.tsx) and their tests: what a console would send for a
// SentinelOne threat, an Axcient x360Recover protected system, a BookStack
// page, a Twilio conversation, an X post and a folder of files, in the
// language asked for, and the writes it takes, kept in memory (nothing leaves
// the page). Invented records: the companies, people, devices and numbers are
// made up (Acme Fabrication, Ada Lindqvist, Noor Haddad, Bruno Tremblay), the
// addresses are `.example`.
export type Lang = "fr" | "en";
type Raw = Record<string, unknown>;

export const PLUGIN_PRODUCTS = {
  threat: { id: "sentinelone", kind: "threat", record: "1873402291", name: "SentinelOne", mark: "https://marks.example/s1.svg" },
  backup: { id: "axcient_x360recover", kind: "device", record: "5512", name: "Axcient x360Recover", mark: "https://marks.example/ax.svg" },
  page: { id: "bookstack", kind: "page", record: "318", name: "BookStack", mark: "https://marks.example/bs.svg" },
  conversation: { id: "twilio_api", kind: "message", record: "AC0001:SM6f3e12d0", name: "Twilio", mark: "https://marks.example/tw.svg" },
  post: { id: "x_api", kind: "post", record: "1861402200417", name: "X", mark: "https://marks.example/x.svg" },
  folder: { id: "files", kind: "folder", record: "acme", name: "Files", mark: "https://marks.example/files.svg" },
} as const;
export type PluginScene = keyof typeof PLUGIN_PRODUCTS;

const ADA = "Ada Lindqvist", NOOR = "Noor Haddad", BRUNO = "Bruno Tremblay";
const TZ = "America/Toronto";
/** The gallery's held time: 2026-11-27 13:50 in Toronto. */
export const PLUGIN_NOW = Date.parse("2026-11-27T13:50:00-05:00");

export function pluginConsole(lang: Lang, cardOnly: boolean) {
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  // the console's own words: Quebec French (13 h 52), American English
  const locale = lang === "fr" ? "fr-CA" : "en-US";
  const iso = (local: string) => new Date(`${local}-05:00`).toISOString();
  const clock = (local: string) => new Intl.DateTimeFormat(locale, { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso(local)));
  const day = (local: string) => new Intl.DateTimeFormat(locale, { timeZone: TZ, day: "numeric", month: "short" }).format(new Date(iso(local)));
  const P = PLUGIN_PRODUCTS;
  const ref = (scene: PluginScene, id: string, kind: string = P[scene].kind) => ({ product: P[scene].id, kind, id });
  const meta = (scene: PluginScene, kindName: string) => ({ product: { id: P[scene].id, name: scene === "folder" ? L("Fichiers", "Files") : P[scene].name, icon: { url: P[scene].mark } }, kind: { id: P[scene].kind, name: kindName } });
  const stamp = { tz: TZ, as_of: new Date(PLUGIN_NOW - 2 * 60_000).toISOString(), cached: false };
  const products = (Object.keys(P) as PluginScene[]).map((scene) => ({
    id: P[scene].id, name: scene === "folder" ? L("Fichiers", "Files") : P[scene].name, state: "connected", icon: { url: P[scene].mark },
    records: [{ kind: P[scene].kind, name: { en: ({ threat: "Threat", backup: "Protected system", page: "Page", conversation: "Message", post: "Post", folder: "Folder" } as const)[scene], fr: ({ threat: "Menace", backup: "Système protégé", page: "Page", conversation: "Message", post: "Publication", folder: "Dossier" } as const)[scene] } },
      ...(scene === "threat" ? [{ kind: "agent", name: { en: "Agent", fr: "Agent" } }] : [])],
  }));

  // ── SentinelOne: a threat ──
  const threat = {
    isolated: false,
    verdict: { label: L("Malveillant", "Malicious"), tone: "alert" },
    state: { label: L("Atténuée, à confirmer", "Mitigated, to confirm"), tone: "waiting" },
    done: [L("Mis en quarantaine", "Quarantined"), L("Processus arrêté", "Process killed")],
    notes: [{ id: "n1", author: NOOR, timestamp: iso("2026-11-27T14:05"), text: L("Bruno confirme qu'il ne connaît pas l'expéditeur. Je vérifie les autres boîtes du domaine.", "Bruno confirms he does not know the sender. I am checking the domain's other mailboxes.") }],
  };
  const threatSteps = [
    ["done", "2026-11-27T13:51", L("Courriel reçu de factures@fournisseur-inconnu.example avec une pièce jointe", "Email received from invoices@unknown-supplier.example with an attachment")],
    ["alert", "2026-11-27T13:52", L("Pièce jointe ouverte : facture_oct.pdf.exe", "Attachment opened: invoice_oct.pdf.exe")],
    ["alert", "2026-11-27T13:52", L("Détection par l'IA statique : Trojan.Agent", "Static AI detection: Trojan.Agent")],
    ["done", "2026-11-27T13:52", L("Processus arrêté automatiquement", "Process killed automatically")],
    ["done", "2026-11-27T13:52", L("Fichier mis en quarantaine", "File quarantined")],
    ["done", "2026-11-27T13:54", L("Noor Haddad a créé le billet #300190 pour Acme Fabrication", "Noor Haddad created ticket #300190 for Acme Fabrication")],
    ["", "2026-11-27T14:10", L("En attente de ta confirmation : menace réelle ou faux positif", "Waiting for your confirmation: true threat or false positive")],
  ] as const;
  const threatCard = (): Raw => ({
    ...meta("threat", L("Menace", "Threat")), id: P.threat.record, number: "Trojan.Agent", title: L("Trojan.Agent sur ACME-PC-014", "Trojan.Agent on ACME-PC-014"),
    state: threat.state,
    fields: [
      { label: L("Appareil", "Endpoint"), value: "ACME-PC-014", type: "ref", ref: ref("threat", "77001", "agent") },
      { label: "Site", value: "Acme Fabrication" },
      { label: "Classification", value: "Trojan" },
      { label: L("Atténuation", "Mitigation"), value: L("Mise en quarantaine", "Quarantined") },
      { label: L("Détectée", "Detected"), value: L("il y a 2 h", "2 hours ago"), type: "ago", at: iso("2026-11-27T13:52") },
      { label: L("Dernier utilisateur", "Last user"), value: BRUNO, type: "person", role: "contact" },
      { label: L("Fichier", "File"), value: "C:\\Users\\btremblay\\Downloads\\facture_oct.pdf.exe" },
      { label: "SHA-1", value: "3f9a7c1e0b44d2a98e1f5c6b7a3d9e2f8b02c21e" },
    ],
    lines: { state: "ok", title: L("Chronologie", "Timeline"), items: threatSteps.slice(0, 6).map(([, at, text]) => ({ label: text, detail: clock(at) })), total: threatSteps.length, more: true },
    open_url: "https://console.example/threats/1873402291", ...stamp,
  });
  const threatSection = (name: string): Raw | null => {
    switch (name) {
      case "counts": return { counts: { timeline: threatSteps.length, notes: threat.notes.length, exclusions: 0 }, actions: ["threat.rollback", "threat.isolate", "threat.reconnect", "threat.verdict", "note.add", "note.update", "note.remove"] };
      case "view": return { view: {
        verdict: { ...threat.verdict, detail: L(`Confiance élevée · détecté par l'IA statique à ${clock("2026-11-27T13:52")} · utilisateur ${BRUNO}`, `High confidence · detected by the static AI at ${clock("2026-11-27T13:52")} · user ${BRUNO}`) },
        done: threat.done,
        tree: [
          { depth: 0, name: "explorer.exe", detail: "Windows", tone: "done" },
          { depth: 1, name: "outlook.exe", detail: L("Microsoft, signé", "Microsoft, signed"), tone: "done" },
          { depth: 2, name: L("facture_oct.pdf.exe", "invoice_oct.pdf.exe"), detail: L("Non signé · ouvert depuis une pièce jointe", "Unsigned · opened from an attachment"), tone: "alert" },
          { depth: 3, name: "powershell.exe -enc JABzAD0A…", detail: L("Commande encodée", "Encoded command"), tone: "alert" },
        ],
        file: [
          { label: L("Nom", "Name"), value: L("facture_oct.pdf.exe", "invoice_oct.pdf.exe") },
          { label: L("Chemin", "Path"), value: "C:\\Users\\btremblay\\Downloads\\", code: true },
          { label: "SHA-1", value: "3f9a 7c1e … 8b02 c21e", code: true },
          { label: "Signature", value: L("Aucune", "None"), tone: "alert" },
          { label: L("Taille", "Size"), value: L("1,4 Mo", "1.4 MB") },
          { label: L("Vu la première fois", "First seen"), value: L(`aujourd'hui, ${clock("2026-11-27T13:52")}`, `today, ${clock("2026-11-27T13:52")}`) },
        ],
        device: { name: "ACME-PC-014", ref: ref("threat", "77001", "agent"), detail: L(`Acme Fabrication · Windows 11 · agent 24.1.4 · ${BRUNO}`, `Acme Fabrication · Windows 11 · agent 24.1.4 · ${BRUNO}`),
          state: threat.isolated ? { label: L("Isolé du réseau", "Isolated from the network"), tone: "waiting" } : { label: L("Connecté au réseau", "Connected to the network"), tone: "done" }, isolated: threat.isolated },
        device_tiles: [
          { label: "Agent", value: "24.1.4", detail: L("à jour", "up to date") },
          { label: L("Dernier contact", "Last seen"), value: L("il y a 1 min", "1 min ago") },
          { label: L("Menaces 30 j", "Threats, 30 days"), value: "1", detail: L("celle-ci", "this one"), tone: "waiting" },
          { label: L("Politique", "Policy"), value: L("Protéger", "Protect"), detail: L("tuer et mettre en quarantaine", "kill and quarantine") },
        ],
        device_facts: [
          { label: L("Nom", "Name"), value: "ACME-PC-014" },
          { label: "Site", value: L("Acme Fabrication · Atelier", "Acme Fabrication · Workshop") },
          { label: L("Système", "System"), value: "Windows 11 Pro 23H2" },
          { label: L("Utilisateur", "User"), value: BRUNO },
          { label: L("Adresse IP", "IP address"), value: "10.20.4.37" },
        ],
      } };
      case "timeline": return { lines: threatSteps.map(([tone, at, text], index) => ({ id: `t${index}`, text, when: clock(at), ...(tone ? { tone } : {}) })), next: null };
      case "notes": return { lines: threat.notes, next: null };
      case "exclusions": return { lines: [], next: null };
      default: return null;
    }
  };

  // ── Axcient x360Recover: a protected system ──
  const days = Array.from({ length: 30 }, (_, index) => {
    const at = new Date(PLUGIN_NOW - (29 - index) * 86_400_000);
    const tone = index === 15 ? "alert" : index === 9 || index === 22 ? "waiting" : "done";
    const words = new Intl.DateTimeFormat(locale, { timeZone: TZ, day: "numeric", month: "short" }).format(at);
    return { day: words, tone, label: tone === "alert" ? L("Échec : le volume D: était plein", "Failed: the D: volume was full") : tone === "waiting" ? L("Réussie avec un avertissement", "Succeeded with a warning") : L("Réussie", "Succeeded") };
  });
  const failure = days[15]!.day;
  const backup = { runs: 0 };
  const points = Array.from({ length: 214 }, (_, index) => {
    const at = new Date(PLUGIN_NOW - 20 * 60_000 - index * 3_600_000);
    const boot = index === 9;
    const when = new Intl.DateTimeFormat(locale, { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }).format(at);
    return { id: `rp${index}`, at: at.toISOString(), when, kind: boot ? L("Vérification de démarrage", "Boot check") : index % 24 === 23 ? L("Consolidation quotidienne", "Daily consolidation") : L("Incrémentale", "Incremental"), size: boot ? L("capture prise", "screenshot taken") : L(`${(1 + (index % 7) * 0.3).toFixed(1).replace(".", ",")} Go`, `${(1 + (index % 7) * 0.3).toFixed(1)} GB`), verified: index % 5 !== 3 };
  });
  const backupCard = (): Raw => ({
    ...meta("backup", L("Système protégé", "Protected system")), id: P.backup.record, number: "ACME-SRV01", title: "ACME-SRV01",
    state: { label: L("Sauvegarde OK", "Backup OK"), tone: "done" },
    fields: [
      { label: "Client", value: "Acme Fabrication" },
      { label: L("Système d'exploitation", "Operating system"), value: "Windows Server 2022" },
      { label: L("Adresse IP", "IP address"), value: "10.20.1.10" },
      { label: L("Version de l'agent", "Agent version"), value: "3.14.2" },
      { label: L("Dernier point local", "Last local point"), value: L("il y a 42 min", "42 min ago"), type: "ago", at: new Date(PLUGIN_NOW - 42 * 60_000).toISOString() },
      { label: L("Utilisation locale", "Local usage"), value: L("1,2 To", "1.2 TB") },
    ],
    open_url: "https://backup.example/devices/5512", ...stamp,
  });
  const backupSection = (name: string, page: number): Raw | null => {
    switch (name) {
      case "counts": return { counts: { restore_points: points.length, volumes: 2 }, actions: ["backup.run"] };
      case "view": return { view: {
        tiles: [
          { label: L("Dernière sauvegarde", "Last backup"), value: backup.runs ? L("à l'instant", "just now") : L("il y a 42 min", "42 min ago"), detail: L("incrémentale · 1,8 Go", "incremental · 1.8 GB") },
          { label: L("Prochaine", "Next"), value: clock("2026-11-27T14:30"), detail: L("toutes les heures", "every hour") },
          { label: L("Vérification de démarrage", "Boot check"), value: L("Réussie", "Passed"), detail: L(`ce matin à ${clock("2026-11-27T04:10")}`, `this morning at ${clock("2026-11-27T04:10")}`), tone: "done" },
          { label: L("Rétention", "Retention"), value: L("1 an", "1 year"), detail: L("214 points", "214 points") },
        ],
        days,
        days_summary: L("27 réussis · 2 avec avertissement · 1 échec", "27 succeeded · 2 with a warning · 1 failed"),
        days_note: L(`Échec le ${failure} : le volume D: était plein. Réglé le jour même.`, `Failed on ${failure}: the D: volume was full. Fixed the same day.`),
        failure,
        volumes: [
          { name: "C:", label: L("Système", "System"), used: L("82 Go sur 120 Go", "82 GB of 120 GB"), share: 68, fs: "NTFS" },
          { name: "D:", label: L("Données", "Data"), used: L("410 Go sur 1 To", "410 GB of 1 TB"), share: 41, fs: "NTFS" },
        ],
        vault: [
          { label: L("Copie", "Copy"), value: L("Nuage · Montréal", "Cloud · Montreal") },
          { label: L("Synchronisé", "Synced"), value: L("il y a 38 min", "38 min ago") },
          { label: L("Appareil local", "Local appliance"), value: "ACME-BDR01" },
        ],
      } };
      case "restore_points": {
        const size = 50;
        const start = (page - 1) * size;
        return { lines: points.slice(start, start + size), next: start + size < points.length ? page + 1 : null };
      }
      default: return null;
    }
  };

  // ── BookStack: a page ──
  const files = [
    { id: "f1", name: "rapport-sauvegarde-oct.pdf", size: L("220 Ko", "220 KB"), date: L("12 nov. 2026", "Nov 12, 2026"), author: NOOR },
    { id: "f2", name: "capture-verification.png", size: L("640 Ko", "640 KB"), date: L("24 nov. 2026", "Nov 24, 2026"), author: NOOR },
  ];
  const pageCard = (): Raw => ({
    ...meta("page", "Page"), id: P.page.record, number: L("Procédure de sauvegarde", "Backup procedure"), title: L("Procédure de sauvegarde", "Backup procedure"),
    chips: [{ label: L("Révision 6", "Revision 6"), tone: "open" }],
    description: { text: L("Le serveur ACME-SRV01 est protégé par une sauvegarde toutes les heures.", "The ACME-SRV01 server is protected by an hourly backup."), more: true },
    open_url: "https://docs.example/books/acme/page/backup-procedure", ...stamp,
  });
  const pageBody = L(
    "Le serveur ACME-SRV01 est protégé par la sauvegarde. Cette page explique quoi vérifier chaque semaine et quoi faire quand une sauvegarde échoue.\n\n> [!NOTE]\n> Les sauvegardes roulent toutes les heures, et une vérification de démarrage est faite chaque matin à 4 h.\n\n## Chaque semaine\n\n1. Ouvrir le système protégé et regarder les 30 derniers jours.\n2. Confirmer que la dernière vérification de démarrage est réussie.\n3. Vérifier l'espace libre du volume D:.\n\n## Quand une sauvegarde échoue\n\nCommencer par l'état du service sur le serveur :\n\n```powershell\nGet-Service -Name \"Backup*\" | Select-Object Name, Status\n```\n\n> [!WARNING]\n> Ne jamais supprimer un point de restauration sans l'accord écrit du client.",
    "The ACME-SRV01 server is protected by the backup. This page says what to check every week and what to do when a backup fails.\n\n> [!NOTE]\n> Backups run every hour, and a boot check runs every morning at 4 AM.\n\n## Every week\n\n1. Open the protected system and look at the last 30 days.\n2. Confirm the last boot check passed.\n3. Check the free space of the D: volume.\n\n## When a backup fails\n\nStart with the service's state on the server:\n\n```powershell\nGet-Service -Name \"Backup*\" | Select-Object Name, Status\n```\n\n> [!WARNING]\n> Never delete a restore point without the customer's written consent.",
  );
  const pageSection = (name: string): Raw | null => {
    switch (name) {
      case "counts": return { counts: { revisions: 6, attachments: files.length }, actions: ["attachment.add", "attachment.remove"] };
      case "view": return { view: {
        path: [{ label: "Clients" }, { label: "Acme Fabrication" }, { label: L("Sauvegardes", "Backups") }],
        body: pageBody,
        updated: L(`Mise à jour par ${NOOR} il y a 3 jours`, `Updated by ${NOOR} 3 days ago`),
        book: [
          { label: L("Accès et mots de passe", "Access and passwords"), depth: 0 }, { label: L("Réseau", "Network"), depth: 0 },
          { label: L("Sauvegardes", "Backups"), depth: 0, chapter: true }, { label: L("Procédure de sauvegarde", "Backup procedure"), depth: 1, current: true },
          { label: L("Restaurer un fichier", "Restore a file"), depth: 1, ref: ref("page", "319") }, { label: L("Postes de travail", "Workstations"), depth: 0 },
        ],
        facts: [{ label: L("Créée par", "Created by"), value: BRUNO }, { label: L("Le", "On"), value: L("17 mars 2024", "March 17, 2024") }],
        tags: [L("sauvegarde", "backup"), "x360"],
        edit_url: "https://docs.example/books/acme/page/backup-procedure/edit",
      } };
      case "revisions": return { lines: [
        { id: "r6", when: L("24 nov. 2026", "Nov 24, 2026"), author: NOOR, summary: L("Ajout de la vérification du volume D:", "Added the D: volume check") },
        { id: "r5", when: L("12 nov. 2026", "Nov 12, 2026"), author: NOOR, summary: L("Section « Quand une sauvegarde échoue »", "\"When a backup fails\" section") },
        { id: "r4", when: L("3 juin 2026", "Jun 3, 2026"), author: BRUNO, summary: L("Nouveau calendrier des sauvegardes", "New backup schedule") },
        { id: "r3", when: L("8 janv. 2026", "Jan 8, 2026"), author: BRUNO, summary: L("Lien vers le coffre", "Link to the vault") },
        { id: "r2", when: L("2 avr. 2024", "Apr 2, 2024"), author: ADA, summary: L("Corrections", "Corrections") },
        { id: "r1", when: L("17 mars 2024", "Mar 17, 2024"), author: BRUNO, summary: L("Page créée", "Page created") },
      ], next: null };
      case "attachments": return { lines: files, next: null };
      case "download": return { name: "file.pdf", contentType: "application/pdf", base64: btoa("PDF") };
      default: return null;
    }
  };

  // ── Twilio: a conversation ──
  const OURS = "+1 819 555-0100", HERS = "+1 418 555-0142";
  const life = (state: string, at: string) => state === "received"
    ? [{ text: L("Reçu par Twilio", "Received by Twilio"), when: clock(at), tone: "done" }, { text: L("Transmis à Sagax (webhook)", "Forwarded to Sagax (webhook)"), when: clock(at), tone: "done" }]
    : state === "undelivered"
      ? [{ text: L("Accepté", "Accepted"), when: `${clock(at)}:00`, tone: "done" }, { text: L("Envoyé à l'opérateur", "Sent to the carrier"), when: `${clock(at)}:01`, tone: "done" }, { text: L("Non livré · erreur 30007", "Undelivered · error 30007"), when: `${clock(at)}:04`, tone: "alert" }]
      : [{ text: L("Accepté", "Accepted"), when: `${clock(at)}:00`, tone: "done" }, { text: L("Envoyé à l'opérateur", "Sent to the carrier"), when: `${clock(at)}:01`, tone: "done" }, { text: L("Livré au téléphone", "Delivered to the phone"), when: `${clock(at)}:03`, tone: "done" }];
  const status: Record<string, [string, string]> = { delivered: [L("Livré", "Delivered"), "done"], received: [L("Reçu", "Received"), "open"], undelivered: [L("Non livré", "Undelivered"), "alert"], sent: [L("Envoyé", "Sent"), "open"] };
  const yesterday = L("Jeudi 26 novembre", "Thursday, November 26"), today = L("Aujourd'hui", "Today");
  const sms = [
    ["SM8c2fa41d", "out", "2026-11-26T16:12", "delivered", yesterday, L("Bonjour Ada, l'invitation pour la rencontre du 14 décembre vous a été envoyée par courriel.", "Hello Ada, the invitation for the December 14 meeting was sent to you by email."), `${NOOR}, ${L("depuis Sagax", "from Sagax")}`],
    ["SM1e079b3c", "in", "2026-11-26T16:30", "received", yesterday, L("Merci ! Je confirme ma présence.", "Thanks! I confirm I will be there."), ""],
    ["SM44ab07ef", "out", "2026-11-27T09:02", "delivered", today, L("Rappel : le technicien passe aujourd'hui à 15 h pour l'imprimante du 2e étage.", "Reminder: the technician comes today at 3 PM for the 2nd floor printer."), L("Un bot, par l'API", "A bot, through the API")],
    ["SM9d10c2a8", "in", "2026-11-27T09:15", "received", today, L("Parfait, je serai là.", "Perfect, I will be there."), ""],
    ["SM6f3e12d0", "out", "2026-11-27T11:00", "undelivered", today, L("Votre facture F-10391 est en retard. Payez en ligne : https://pay.example/f10391", "Your invoice F-10391 is late. Pay online: https://pay.example/f10391"), L("Rappel automatique", "Automatic reminder")],
    ["SMa2c95e61", "in", "2026-11-27T13:40", "received", today, L("Est-ce qu'on peut repousser à 15 h 30 ?", "Can we push it to 3:30 PM?"), ""],
  ] as Array<[string, "in" | "out", string, string, string, string, string]>;
  const message = ([id, direction, at, state, dayWords, body, by]: (typeof sms)[number]): Raw => ({
    id, direction, at: iso(at), when: clock(at), day: dayWords, body, state, status: status[state]![0], tone: status[state]![1], ...(by ? { by } : {}),
    from: direction === "in" ? HERS : OURS, to: direction === "in" ? OURS : HERS, service: L("Notifications", "Notifications"),
    segments: L(`1 · GSM-7 · ${body.length} caractères`, `1 · GSM-7 · ${body.length} characters`), price: L("0,0079 $ US", "$0.0079 USD"),
    ...(state === "undelivered" ? { error: { code: "30007", title: L("Filtré par l'opérateur", "Filtered by the carrier"), cause: L("Le lien de paiement ressemble à du pourriel.", "The payment link looks like spam."), fix: L("Envoie le rappel sans lien, ou par courriel.", "Send the reminder without the link, or by email.") } } : {}),
    life: life(state, at),
  });
  const others = [
    ["SM70aa0b11", "out", "2026-11-27T08:30", "delivered", today, L("Votre billet #300124 est résolu.", "Your ticket #300124 is resolved."), L("Un bot, par l'API", "A bot, through the API")],
    ["SM70aa0b12", "out", "2026-11-26T10:05", "delivered", yesterday, L("Rappel de rendez-vous demain à 9 h.", "Appointment reminder tomorrow at 9 AM."), L("Rappel automatique", "Automatic reminder")],
    ["SM70aa0b13", "out", "2026-11-26T09:40", "sent", yesterday, L("Merci pour votre paiement.", "Thanks for your payment."), L("Rappel automatique", "Automatic reminder")],
  ] as typeof sms;
  const conversationCard = (): Raw => ({
    ...meta("conversation", "Message"), id: P.conversation.record, number: HERS, title: `${ADA} · ${HERS}`,
    chips: [{ label: "SMS", tone: "open" }],
    fields: [{ label: L("De", "From"), value: OURS }, { label: L("Vers", "To"), value: HERS }, { label: "Direction", value: "outbound-api" }, { label: L("Erreur", "Error"), value: "30007" }, { label: "Segments", value: "1" }],
    description: { text: sms[4]![5], more: false },
    open_url: "https://console.twilio.example/messages/SM6f3e12d0", ...stamp,
  });
  const conversationSection = (name: string): Raw | null => {
    switch (name) {
      case "counts": return { counts: { conversation: sms.length, log: sms.length + others.length, calls: 2, media: 0 }, actions: ["message.send"] };
      case "view": return { view: { stats: { title: L("Ce mois sur ce numéro :", "This month on this number:"), parts: [{ text: L("612 messages", "612 messages"), strong: true }, { text: L("98,4 % livrés", "98.4% delivered") }, { text: L("3 erreurs", "3 errors"), tone: "alert" }, { text: L("14,20 $ US", "$14.20 USD") }] } } };
      case "conversation": return { lines: sms.map(message), next: null };
      // the log names the day of each message and its segments as a number
      case "log": return { lines: [...sms, ...others].sort((a, b) => b[2].localeCompare(a[2])).map((one) => ({ ...message(one), when: `${day(one[2])}, ${clock(one[2])}`, segments: "1" })), next: null };
      case "calls": return { lines: [
        { id: "CA71be02", direction: "in", when: L(`26 nov., ${clock("2026-11-26T10:14")}`, `Nov 26, ${clock("2026-11-26T10:14")}`), duration: L("4 min 12 s", "4 min 12 s"), transcript: L("Ada demande où en est le renouvellement des licences.", "Ada asks how the license renewal is going."), recording: true },
        { id: "CA0c41f9", direction: "out", when: L(`23 nov., ${clock("2026-11-23T15:05")}`, `Nov 23, ${clock("2026-11-23T15:05")}`), duration: L("6 min 40 s", "6 min 40 s"), transcript: L("Suivi du partenariat et des documents à signer.", "Follow-up of the partnership and the documents to sign."), recording: true },
      ], next: null };
      case "number": return { view: {
        number: OURS,
        facts: [{ label: L("Nom", "Name"), value: L("Ligne principale", "Main line") }, { label: L("Région", "Region"), value: L("Québec, Canada", "Quebec, Canada") }, { label: "Service", value: L("Notifications", "Notifications") }],
        capabilities: ["SMS", "MMS", L("Voix", "Voice")],
        routing_title: L("Quand quelqu'un écrit ou appelle", "When someone writes or calls"),
        routing: [{ label: "Messages", value: L("Un bot répond dans Sagax", "A bot answers in Sagax") }, { label: L("Appels", "Calls"), value: L("Transférés au bureau, transcrits", "Forwarded to the office, transcribed") }, { label: L("Hors heures", "After hours"), value: L("Message vocal, puis billet", "Voicemail, then a ticket") }],
      } };
      case "media": return { lines: [], next: null };
      case "recording": return { contentType: "audio/wav", base64: silentWav() };
      default: return null;
    }
  };

  // ── X: a post ──
  // X's own posts, as the X API gives them (the chat's X cards read the same, shared/x-post.ts readXPost); pictures on X's own CDN
  const post = { pinned: false, bookmarked: false, replies: [
    { id: "1861500000001", handle: "lina_ti", name: "Lina Roy", avatarUrl: "https://pbs.twimg.com/profile_images/lina.png", created_at: "2026-11-25T15:40:00-05:00", text: L("On fait ça aussi, ça a sauvé un client le mois passé.", "We do that too, it saved a customer last month."), in_reply_to_screen_name: "nimbus_msp", public_metrics: { reply_count: 1, retweet_count: 0, like_count: 5, impression_count: 310 } },
    { id: "1861500000002", handle: "omar_b", name: "Omar B.", created_at: "2026-11-25T16:05:00-05:00", text: L("Ça coûte combien pour 3 serveurs ?", "How much for 3 servers?"), in_reply_to_screen_name: "nimbus_msp", public_metrics: { reply_count: 0, retweet_count: 0, like_count: 2, impression_count: 204 } },
  ] as Raw[] };
  const postCard = (): Raw => ({
    ...meta("post", L("Publication", "Post")), id: P.post.record, number: L("Publication du 25 nov.", "Post of Nov 25"), title: L("Publication du 25 nov. 2026", "Post of Nov 25, 2026"),
    state: { label: L("Publiée", "Published"), tone: "done" },
    open_url: "https://x.example/nimbus_msp/status/1861402200417", ...stamp,
  });
  const postSection = (name: string): Raw | null => {
    switch (name) {
      case "counts": return { counts: { replies: post.replies.length }, actions: ["post.reply", "post.pin", "post.unpin", "post.remove", "post.bookmark", "post.unbookmark"] };
      case "view": return { view: {
        post: {
          id: P.post.record, handle: "nimbus_msp", name: "Nimbus MSP", verified: true, avatarUrl: "https://pbs.twimg.com/profile_images/nimbus.png", created_at: "2026-11-25T09:00:00-05:00",
          text: L("Votre sauvegarde a-t-elle été testée ce mois-ci ? Chez nos clients, chaque serveur redémarre en machine virtuelle tous les matins pour le prouver. #TI #PME", "Was your backup tested this month? At our customers, every server boots as a virtual machine every morning to prove it. #IT #SMB"),
          media: [{ type: "photo", url: "https://pbs.twimg.com/media/boot-check.png", alt: L("Capture de la vérification de démarrage d'ACME-SRV01", "Screenshot of ACME-SRV01's boot check") }],
          public_metrics: { reply_count: 2 + post.replies.length, retweet_count: 6, like_count: 38, impression_count: 12_400, bookmark_count: 9 },
        },
        bookmarked: post.bookmarked,
        tiles: [{ label: L("Engagement", "Engagement"), value: L("3,1 %", "3.1%"), detail: L("deux fois ta moyenne", "twice your average") }, { label: L("Clics sur le lien", "Link clicks"), value: "84" }, { label: L("Nouveaux abonnés", "New followers"), value: "12" }, { label: L("Enregistrements", "Bookmarks"), value: "9" }],
        pinned: post.pinned,
      } };
      case "replies": return { lines: post.replies, next: null };
      case "stats": return { view: {
        hourly_title: L("Vues, premières 24 h", "Views, first 24 hours"),
        hourly: [["1 h", 3.1], ["2 h", 2.4], ["3 h", 1.9], ["4 h", 1.2], ["6 h", 0.9], ["9 h", 0.8], ["12 h", 0.6], ["24 h", 0.5]].map(([label, value]) => ({ label, value, text: L(`${String(value).replace(".", ",")} k vues`, `${value}K views`) })),
        sources_title: L("D'où viennent les vues", "Where the views come from"),
        sources: [{ label: L("Pour vous", "For you"), share: 62, text: L("62 %", "62%") }, { label: L("Abonnés", "Followers"), share: 28, text: L("28 %", "28%") }, { label: L("Recherche", "Search"), share: 10, text: L("10 %", "10%") }],
      } };
      default: return null;
    }
  };

  // ── Files: a folder ──
  const items = [
    { id: "d1", name: L("Contrats", "Contracts"), folder: true, modified: L("27 nov. 2026, 13 h 02", "Nov 27, 2026, 1:02 PM"), tag: "orange", ref: ref("folder", "contracts") },
    { id: "d2", name: L("Factures", "Invoices"), folder: true, modified: L("1 nov. 2026, 9 h 15", "Nov 1, 2026, 9:15 AM"), ref: ref("folder", "invoices") },
    { id: "d3", name: L("Photos du chantier", "Site photos"), folder: true, modified: L("20 nov. 2026, 16 h 40", "Nov 20, 2026, 4:40 PM"), ref: ref("folder", "photos") },
    { id: "d4", name: L("Procédures", "Procedures"), folder: true, modified: L("24 nov. 2026, 11 h 20", "Nov 24, 2026, 11:20 AM"), tag: "blue", ref: ref("folder", "procedures") },
    { id: "f1", name: "contrat-adhesion.pdf", size: L("412 Ko", "412 KB"), modified: L("27 nov. 2026, 13 h 21", "Nov 27, 2026, 1:21 PM"), type: L("Document PDF", "PDF document"), tag: "orange", shared: ADA },
    { id: "f2", name: "grille-tarifaire.xlsx", size: L("38 Ko", "38 KB"), modified: L("26 nov. 2026, 16 h 05", "Nov 26, 2026, 4:05 PM"), type: L("Classeur Excel", "Excel workbook") },
    { id: "f3", name: "plan-reseau.vsdx", size: L("1,1 Mo", "1.1 MB"), modified: L("3 nov. 2026, 10 h 48", "Nov 3, 2026, 10:48 AM"), type: L("Dessin Visio", "Visio drawing") },
    { id: "f4", name: "photo-imprimante.png", size: L("1,2 Mo", "1.2 MB"), modified: L("aujourd'hui, 9 h 12", "today, 9:12 AM"), type: L("Image PNG", "PNG image"), tag: "red" },
  ];
  const folderName = (id: string) => id === "acme" ? "Acme Fabrication" : items.find((one) => (one.ref as { id?: string } | undefined)?.id === id)?.name ?? id;
  const folderCard = (id: string): Raw => ({
    ...meta("folder", L("Dossier", "Folder")), id, number: folderName(id), title: folderName(id),
    chips: [{ label: id === "acme" ? L("8 éléments · 4,2 Go", "8 items · 4.2 GB") : L("Vide", "Empty"), tone: "open" }],
    open_url: `https://files.example/clients/${id}`, ...stamp,
  });
  const folderSection = (id: string, name: string): Raw | null => {
    const path = [{ label: L("Partage Clients", "Client share"), ref: ref("folder", "share") }, { label: "Clients", ref: ref("folder", "clients") }, { label: "Acme Fabrication", ref: ref("folder", "acme") }, ...(id === "acme" ? [] : [{ label: folderName(id) }])];
    switch (name) {
      case "counts": return { counts: { items: id === "acme" ? items.length : 0 }, actions: [] };
      case "view": return { view: {
        path,
        places: [
          { group: "favorites", label: L("Récents", "Recents"), icon: "recents" }, { group: "favorites", label: L("Bureau", "Desktop"), icon: "desktop" },
          { group: "favorites", label: "Documents", icon: "documents" }, { group: "favorites", label: L("Téléchargements", "Downloads"), icon: "downloads" },
          { group: "locations", label: L("Partage Clients", "Client share"), icon: "server", current: true }, { group: "locations", label: L("Sauvegardes", "Backups"), icon: "server" },
          { group: "tags", label: L("Urgent", "Urgent"), tag: "red" }, { group: "tags", label: L("À signer", "To sign"), tag: "orange" },
          { group: "tags", label: "Client", tag: "blue" }, { group: "tags", label: L("Livré", "Delivered"), tag: "green" },
        ],
        siblings: [{ label: "Acme Fabrication", current: true }, { label: L("Boulangerie Nimbus", "Nimbus Bakery") }, { label: L("Clinique Lindqvist", "Lindqvist Clinic") }, { label: L("Garage Haddad", "Haddad Garage") }],
        summary: L("8 éléments, 812 Go disponibles", "8 items, 812 GB available"),
      } };
      case "items": return { lines: id === "acme" ? items : [], next: null };
      case "download": return { name: "file.pdf", contentType: "application/pdf", base64: btoa("PDF") };
      default: return null;
    }
  };

  const scenes: Record<string, PluginScene> = Object.fromEntries((Object.keys(P) as PluginScene[]).map((scene) => [`${P[scene].id}/${P[scene].kind}`, scene]));
  return {
    products,
    card(product: string, kind: string, id: string): Raw | null {
      const scene = scenes[`${product}/${kind}`];
      if (scene === "threat") return threatCard();
      if (scene === "backup") return backupCard();
      if (scene === "page") return id === P.page.record ? pageCard() : { ...pageCard(), id, title: L("Restaurer un fichier", "Restore a file"), number: L("Restaurer un fichier", "Restore a file") };
      if (scene === "conversation") return conversationCard();
      if (scene === "post") return postCard();
      if (scene === "folder") return folderCard(id);
      return null;
    },
    /** A detail section, or null for a console that has none (a 404 with its code). */
    section(product: string, kind: string, id: string, name: string, page: number): Raw | null {
      if (cardOnly) return null;
      const scene = scenes[`${product}/${kind}`];
      if (scene === "threat") return threatSection(name);
      if (scene === "backup") return backupSection(name, page);
      if (scene === "page") return id === P.page.record ? pageSection(name) : null;
      if (scene === "conversation") return conversationSection(name);
      if (scene === "post") return postSection(name);
      if (scene === "folder") return folderSection(id, name);
      return null;
    },
    /** A write the page takes: the console's data changes, as a real write would. */
    write(body: { action?: string; id?: string; set?: Record<string, unknown> }): boolean {
      const set = body.set ?? {};
      switch (body.action) {
        case "threat.isolate": threat.isolated = true; return true;
        case "threat.reconnect": threat.isolated = false; return true;
        case "threat.rollback": threat.done = [...threat.done.filter((one) => one !== L("Changements annulés", "Changes undone")), L("Changements annulés", "Changes undone")]; return true;
        case "threat.verdict":
          threat.verdict = set.verdict === "false_positive" ? { label: L("Faux positif", "False positive"), tone: "done" } : { label: L("Menace réelle", "True threat"), tone: "alert" };
          threat.state = { label: L("Résolue", "Resolved"), tone: "done" };
          return true;
        case "note.add": threat.notes.unshift({ id: `n${threat.notes.length + 1}`, author: NOOR, timestamp: new Date(PLUGIN_NOW).toISOString(), text: String(set.text) }); return true;
        case "note.update": { const note = threat.notes.find((one) => one.id === body.id); if (note) note.text = String(set.text ?? note.text); return true; }
        case "note.remove": threat.notes.splice(threat.notes.findIndex((one) => one.id === body.id), 1); return true;
        case "backup.run": backup.runs += 1; return true;
        case "attachment.add": files.unshift({ id: `f${files.length + 3}`, name: String(set.name), size: "1 Ko", date: day("2026-11-27T13:50"), author: NOOR }); return true;
        case "attachment.remove": files.splice(files.findIndex((one) => one.id === body.id), 1); return true;
        case "message.send": sms.push([`SMnew${sms.length}`, "out", "2026-11-27T13:50", "sent", today, String(set.text), NOOR]); return true;
        case "post.reply": post.replies.push({ id: `18615000000${post.replies.length + 3}`, handle: "nimbus_msp", name: "Nimbus MSP", verified: true, created_at: new Date(PLUGIN_NOW).toISOString(), text: String(set.text), in_reply_to_screen_name: "nimbus_msp" }); return true;
        case "post.pin": post.pinned = true; return true;
        case "post.unpin": post.pinned = false; return true;
        case "post.remove": return true;
        case "post.bookmark": post.bookmarked = true; return true;
        case "post.unbookmark": post.bookmarked = false; return true;
        default: return false;
      }
    },
  };
}

/** A short silent WAV (8 kHz, 16-bit mono, 0.2 s): a recording the gallery can play. */
function silentWav(): string {
  const samples = 1_600;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i += 1) bytes[at + i] = value.charCodeAt(i); };
  text(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8_000, true);
  view.setUint32(28, 16_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples * 2, true);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
