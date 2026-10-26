// IT tools: every word a check result is shown with, in English, Québec
// French and Brazilian Portuguese. The server draws the card and its text
// fallback (shared/net-tools/widget.ts, text.ts), so these live here and not
// in src/locales; other UI languages fall back to English. Texts take
// {placeholders} from a finding's params; a test pins that the three
// languages of one text use the same placeholders.
import type { NetCheckName, NetFinding, NetFindingParams, NetLanguage, NetVerdict } from "./types.ts";

export interface NetText {
  en: string;
  fr: string;
  "pt-BR": string;
}

export interface NetFindingText {
  title: NetText;
  /** One or two plain sentences: what it means. */
  text: NetText;
  /** What to change, when there is something to change. */
  fix?: NetText;
}

const t = (en: string, fr: string, pt: string): NetText => ({ en, fr, "pt-BR": pt });

export const NET_CHECK_LABELS: Record<NetCheckName, NetText> = {
  dns_lookup: t("DNS lookup", "Recherche DNS", "Consulta DNS"),
  mx_lookup: t("MX lookup", "Recherche MX", "Consulta MX"),
  mail_auth_check: t("SPF, DKIM and DMARC", "SPF, DKIM et DMARC", "SPF, DKIM e DMARC"),
  blacklist_check: t("Blacklist check", "Vérification des listes noires", "Verificação de listas negras"),
  tls_check: t("SSL/TLS certificate", "Certificat SSL/TLS", "Certificado SSL/TLS"),
  domain_info: t("Domain info", "Infos du nom de domaine", "Informações do domínio"),
  http_headers: t("HTTP headers", "En-têtes HTTP", "Cabeçalhos HTTP"),
  email_header_analyze: t("Email header analysis", "Analyse des en-têtes de courriel", "Análise de cabeçalhos de e-mail"),
  dns_propagation: t("DNS propagation", "Propagation DNS", "Propagação DNS"),
  port_check: t("Port check", "Vérification des ports", "Verificação de portas"),
  tcp_ping: t("TCP reachability (not ICMP)", "Accessibilité TCP (pas ICMP)", "Alcance TCP (não ICMP)"),
};

/** The verdict as a word, so color is never the only signal. */
export const NET_VERDICT_LABELS: Record<NetVerdict, NetText> = {
  pass: t("OK", "OK", "OK"),
  warn: t("Needs attention", "À surveiller", "Requer atenção"),
  fail: t("Problem", "Problème", "Problema"),
  info: t("Info", "Info", "Info"),
  unknown: t("Unknown", "Inconnu", "Desconhecido"),
};

/** The words around the findings on a card and in its text fallback. */
export const NET_CARD_TEXT = {
  caption: t("Checked from this Sagax server · {time}", "Vérifié depuis ce serveur Sagax · {time}", "Verificado a partir deste servidor Sagax · {time}"),
  more: t("and {count} more", "et {count} de plus", "e mais {count}"),
  moreRows: t("{count} more rows not shown", "{count} autres lignes non affichées", "{count} linhas a mais não exibidas"),
  raw: t("Raw output", "Sortie brute", "Saída bruta"),
  rawCut: t("(cut; the full output is in the Tools panel)", "(coupé; la sortie complète est dans le panneau Outils)", "(cortado; a saída completa está no painel Ferramentas)"),
  explain: t("Explain", "Expliquer", "Explicar"),
  fix: t("Suggest a fix", "Proposer un correctif", "Sugerir uma correção"),
  noFindings: t("Nothing to report.", "Rien à signaler.", "Nada a relatar."),
  issues: t("{count} to review", "{count} à revoir", "{count} para revisar"),
};

/** Names of details tables and their columns. A label not listed here (a
 * record type such as "TXT") is shown as it is. */
export const NET_DETAIL_LABELS: Record<string, NetText> = {
  records: t("Records", "Enregistrements", "Registros"),
  type: t("Type", "Type", "Tipo"),
  value: t("Value", "Valeur", "Valor"),
  ttl: t("TTL", "TTL", "TTL"),
  priority: t("Priority", "Priorité", "Prioridade"),
  host: t("Host", "Hôte", "Host"),
  ips: t("IP addresses", "Adresses IP", "Endereços IP"),
  ptr: t("PTR", "PTR", "PTR"),
  mx_hosts: t("Mail servers", "Serveurs de courriel", "Servidores de e-mail"),
  spf: t("SPF", "SPF", "SPF"),
  dkim: t("DKIM", "DKIM", "DKIM"),
  dmarc: t("DMARC", "DMARC", "DMARC"),
  zones: t("Lists checked", "Listes vérifiées", "Listas verificadas"),
  zone: t("List", "Liste", "Lista"),
  ip: t("IP address", "Adresse IP", "Endereço IP"),
  status: t("Status", "Statut", "Status"),
  reason: t("Reason", "Raison", "Motivo"),
  chain: t("Certificate chain", "Chaîne de certificats", "Cadeia de certificados"),
  subject: t("Subject", "Sujet", "Assunto"),
  issuer: t("Issuer", "Émetteur", "Emissor"),
  valid_until: t("Valid until", "Valide jusqu'au", "Válido até"),
  connection: t("Connection", "Connexion", "Conexão"),
  registration: t("Registration", "Enregistrement", "Registro"),
  field: t("Field", "Champ", "Campo"),
  nameservers: t("Name servers", "Serveurs de noms", "Servidores de nomes"),
  redirects: t("Redirects", "Redirections", "Redirecionamentos"),
  url: t("URL", "URL", "URL"),
  headers: t("Headers", "En-têtes", "Cabeçalhos"),
  header: t("Header", "En-tête", "Cabeçalho"),
  hops: t("Hops", "Relais", "Saltos"),
  from: t("From", "De", "De"),
  by: t("By", "Par", "Por"),
  when: t("When", "Quand", "Quando"),
  delay: t("Delay", "Délai", "Atraso"),
  auth: t("Authentication", "Authentification", "Autenticação"),
  result: t("Result", "Résultat", "Resultado"),
  alignment: t("Alignment", "Alignement", "Alinhamento"),
  port: t("Port", "Port", "Porta"),
  service: t("Service", "Service", "Serviço"),
  state: t("State", "État", "Estado"),
  resolver: t("Resolver", "Résolveur", "Resolvedor"),
  answer: t("Answer", "Réponse", "Resposta"),
  timing: t("Timing", "Temps", "Tempo"),
};

const f = (title: NetText, text: NetText, fix?: NetText): NetFindingText => (fix ? { title, text, fix } : { title, text });

/** Every finding code a check may report, with its words. */
export const NET_FINDINGS: Record<string, NetFindingText> = {
  // ── Refusals and errors (any check) ─────────────────────────────────────
  "target.empty": f(
    t("No target", "Aucune cible", "Nenhum alvo"),
    t("Type a domain name, a host or an IP address to check.", "Entrez un nom de domaine, un hôte ou une adresse IP à vérifier.", "Digite um nome de domínio, um host ou um endereço IP para verificar."),
  ),
  "target.too_long": f(
    t("Name too long", "Nom trop long", "Nome muito longo"),
    t("A domain name has at most 253 characters.", "Un nom de domaine compte au plus 253 caractères.", "Um nome de domínio tem no máximo 253 caracteres."),
  ),
  "target.invalid": f(
    t("Not a valid target", "Cible non valide", "Alvo inválido"),
    t("This is not a valid domain name, host or IP address.", "Ce n'est pas un nom de domaine, un hôte ou une adresse IP valide.", "Isto não é um nome de domínio, host ou endereço IP válido."),
  ),
  "target.refused_name": f(
    t("Internal name refused", "Nom interne refusé", "Nome interno recusado"),
    t("Internal, local and single-label names are not checked from this server.", "Les noms internes, locaux ou sans point ne sont pas vérifiés depuis ce serveur.", "Nomes internos, locais ou de um só rótulo não são verificados a partir deste servidor."),
  ),
  "target.refused_address": f(
    t("Private address refused", "Adresse privée refusée", "Endereço privado recusado"),
    t("{target} points to an address that is not public ({reason}). Only public targets are checked.", "{target} pointe vers une adresse non publique ({reason}). Seules les cibles publiques sont vérifiées.", "{target} aponta para um endereço não público ({reason}). Apenas alvos públicos são verificados."),
  ),
  "target.bad_port": f(
    t("Port not allowed", "Port non permis", "Porta não permitida"),
    t("Use a port number from 1 to 65535 that this check allows.", "Utilisez un numéro de port de 1 à 65535 permis pour cette vérification.", "Use um número de porta de 1 a 65535 permitido para esta verificação."),
  ),
  "target.bad_url": f(
    t("Not a web address", "Pas une adresse Web", "Não é um endereço web"),
    t("Use an http or https address.", "Utilisez une adresse http ou https.", "Use um endereço http ou https."),
  ),
  "target.url_credentials": f(
    t("Address with a password refused", "Adresse avec mot de passe refusée", "Endereço com senha recusado"),
    t("Remove the user name and password from the address.", "Retirez le nom d'utilisateur et le mot de passe de l'adresse.", "Remova o nome de usuário e a senha do endereço."),
  ),
  "target.not_typed": f(
    t("Host not typed by the person", "Hôte non tapé par la personne", "Host não digitado pela pessoa"),
    t("Ask the person to type the host to check.", "Demandez à la personne de taper l'hôte à vérifier.", "Peça à pessoa para digitar o host a verificar."),
  ),
  "limit.rate": f(
    t("Too many checks", "Trop de vérifications", "Verificações demais"),
    t("Too many checks, try again in {minutes} min.", "Trop de vérifications, réessayez dans {minutes} min.", "Verificações demais, tente novamente em {minutes} min."),
  ),
  "limit.busy": f(
    t("Server busy", "Serveur occupé", "Servidor ocupado"),
    t("Too many checks are running on this server. Try again in a moment.", "Trop de vérifications sont en cours sur ce serveur. Réessayez dans un instant.", "Há verificações demais em andamento neste servidor. Tente novamente em instantes."),
  ),
  "check.timeout": f(
    t("No answer in time", "Pas de réponse à temps", "Sem resposta a tempo"),
    t("The check did not finish within {seconds} s. This is not a failure of the target.", "La vérification ne s'est pas terminée en {seconds} s. Ce n'est pas un échec de la cible.", "A verificação não terminou em {seconds} s. Isto não é uma falha do alvo."),
  ),
  "check.no_egress": f(
    t("Could not test from this server", "Test impossible depuis ce serveur", "Não foi possível testar a partir deste servidor"),
    t("This server's network blocks this kind of test, so the result says nothing about the target.", "Le réseau de ce serveur bloque ce type de test; le résultat ne dit rien sur la cible.", "A rede deste servidor bloqueia este tipo de teste, então o resultado não diz nada sobre o alvo."),
  ),
  "check.error": f(
    t("Check failed to run", "La vérification n'a pas pu s'exécuter", "A verificação não pôde ser executada"),
    t("Something went wrong on this server while checking. Try again.", "Une erreur est survenue sur ce serveur pendant la vérification. Réessayez.", "Algo deu errado neste servidor durante a verificação. Tente novamente."),
  ),

  // ── DNS lookup ──────────────────────────────────────────────────────────
  "dns.records_found": f(
    t("{count} records found", "{count} enregistrements trouvés", "{count} registros encontrados"),
    t("The name resolves and its records are listed below.", "Le nom se résout et ses enregistrements sont listés ci-dessous.", "O nome resolve e seus registros estão listados abaixo."),
  ),
  "dns.nxdomain": f(
    t("Name does not exist", "Le nom n'existe pas", "O nome não existe"),
    t("{name} does not exist in DNS (NXDOMAIN).", "{name} n'existe pas dans le DNS (NXDOMAIN).", "{name} não existe no DNS (NXDOMAIN)."),
    t("Check the spelling, or create the record at the DNS host.", "Vérifiez l'orthographe ou créez l'enregistrement chez l'hébergeur DNS.", "Confira a grafia ou crie o registro no provedor de DNS."),
  ),
  "dns.no_records": f(
    t("No {type} records", "Aucun enregistrement {type}", "Nenhum registro {type}"),
    t("The name exists but has no {type} records.", "Le nom existe mais n'a aucun enregistrement {type}.", "O nome existe, mas não tem registros {type}."),
  ),
  "dns.cname_at_apex": f(
    t("CNAME at the domain root", "CNAME à la racine du domaine", "CNAME na raiz do domínio"),
    t("A CNAME on the bare domain conflicts with its MX, NS and SOA records and breaks mail.", "Un CNAME sur le domaine nu entre en conflit avec ses enregistrements MX, NS et SOA et brise le courriel.", "Um CNAME no domínio raiz conflita com os registros MX, NS e SOA e quebra o e-mail."),
    t("Replace it with A/AAAA records, or an ALIAS/ANAME record if the DNS host offers one.", "Remplacez-le par des enregistrements A/AAAA, ou un enregistrement ALIAS/ANAME si l'hébergeur DNS en offre.", "Substitua por registros A/AAAA, ou um registro ALIAS/ANAME se o provedor de DNS oferecer."),
  ),
  "dns.lame_ns": f(
    t("Name server not answering", "Serveur de noms qui ne répond pas", "Servidor de nomes sem resposta"),
    t("{ns} is listed as a name server but does not answer for this domain.", "{ns} est listé comme serveur de noms mais ne répond pas pour ce domaine.", "{ns} está listado como servidor de nomes, mas não responde por este domínio."),
    t("Remove it from the NS records or add the zone to it.", "Retirez-le des enregistrements NS ou ajoutez-y la zone.", "Remova-o dos registros NS ou adicione a zona a ele."),
  ),
  "dns.soa_serial_mismatch": f(
    t("Name servers disagree", "Serveurs de noms en désaccord", "Servidores de nomes divergentes"),
    t("The name servers report different SOA serials, so some answer with older records.", "Les serveurs de noms donnent des numéros de série SOA différents; certains répondent avec d'anciens enregistrements.", "Os servidores de nomes informam seriais SOA diferentes, então alguns respondem com registros antigos."),
    t("Check zone transfers between the primary and secondary servers.", "Vérifiez les transferts de zone entre les serveurs primaire et secondaires.", "Verifique as transferências de zona entre os servidores primário e secundários."),
  ),
  "dns.no_aaaa": f(
    t("No IPv6 address", "Aucune adresse IPv6", "Nenhum endereço IPv6"),
    t("The name has no AAAA record, so it is reachable over IPv4 only.", "Le nom n'a pas d'enregistrement AAAA; il n'est joignable qu'en IPv4.", "O nome não tem registro AAAA, então só é acessível por IPv4."),
  ),
  "dns.dnssec_validated": f(
    t("DNSSEC validated", "DNSSEC validé", "DNSSEC validado"),
    t("The resolver validated the answers with DNSSEC.", "Le résolveur a validé les réponses avec DNSSEC.", "O resolvedor validou as respostas com DNSSEC."),
  ),
  "dns.ptr_missing": f(
    t("No reverse DNS", "Aucun DNS inverse", "Sem DNS reverso"),
    t("{ip} has no PTR record.", "{ip} n'a pas d'enregistrement PTR.", "{ip} não tem registro PTR."),
  ),

  // ── MX lookup ───────────────────────────────────────────────────────────
  "mx.ok": f(
    t("{count} mail servers", "{count} serveurs de courriel", "{count} servidores de e-mail"),
    t("The domain lists mail servers and each one has an address.", "Le domaine liste des serveurs de courriel et chacun a une adresse.", "O domínio lista servidores de e-mail e cada um tem um endereço."),
  ),
  "mx.none": f(
    t("No MX records", "Aucun enregistrement MX", "Nenhum registro MX"),
    t("The domain has no MX records, so senders fall back to its A record or cannot deliver mail.", "Le domaine n'a aucun enregistrement MX; les expéditeurs se rabattent sur son enregistrement A ou ne peuvent pas livrer le courriel.", "O domínio não tem registros MX, então os remetentes usam o registro A ou não conseguem entregar e-mails."),
    t("Add MX records for the mail service, or a null MX if the domain sends no mail.", "Ajoutez des enregistrements MX pour le service de courriel, ou un MX nul si le domaine ne reçoit aucun courriel.", "Adicione registros MX para o serviço de e-mail, ou um MX nulo se o domínio não recebe e-mails."),
  ),
  "mx.null": f(
    t("Domain does not accept mail", "Le domaine n'accepte pas de courriel", "O domínio não aceita e-mails"),
    t("A null MX record (RFC 7505) says this domain accepts no mail.", "Un enregistrement MX nul (RFC 7505) indique que ce domaine n'accepte aucun courriel.", "Um registro MX nulo (RFC 7505) indica que este domínio não aceita e-mails."),
  ),
  "mx.host_no_address": f(
    t("Mail server without an address", "Serveur de courriel sans adresse", "Servidor de e-mail sem endereço"),
    t("{host} has no A or AAAA record, so mail cannot reach it.", "{host} n'a pas d'enregistrement A ou AAAA; le courriel ne peut pas l'atteindre.", "{host} não tem registro A ou AAAA, então o e-mail não chega a ele."),
    t("Add the address record or fix the MX host name.", "Ajoutez l'enregistrement d'adresse ou corrigez le nom de l'hôte MX.", "Adicione o registro de endereço ou corrija o nome do host MX."),
  ),
  "mx.cname": f(
    t("MX points to a CNAME", "Le MX pointe vers un CNAME", "MX aponta para um CNAME"),
    t("{host} is a CNAME. Standards forbid it and some senders refuse it.", "{host} est un CNAME. Les normes l'interdisent et certains expéditeurs le refusent.", "{host} é um CNAME. Os padrões proíbem isso e alguns remetentes recusam."),
    t("Point the MX at the canonical host name.", "Faites pointer le MX vers le nom d'hôte canonique.", "Aponte o MX para o nome de host canônico."),
  ),
  "mx.ip_literal": f(
    t("MX is an IP address", "Le MX est une adresse IP", "MX é um endereço IP"),
    t("{host} is an IP address, but an MX record must name a host.", "{host} est une adresse IP, mais un enregistrement MX doit nommer un hôte.", "{host} é um endereço IP, mas um registro MX deve indicar um host."),
    t("Create a host name with an A record and use it in the MX.", "Créez un nom d'hôte avec un enregistrement A et utilisez-le dans le MX.", "Crie um nome de host com registro A e use-o no MX."),
  ),
  "mx.ptr_missing": f(
    t("Mail server without reverse DNS", "Serveur de courriel sans DNS inverse", "Servidor de e-mail sem DNS reverso"),
    t("{ip} has no PTR record. Receivers often distrust mail from such servers.", "{ip} n'a pas d'enregistrement PTR. Les destinataires se méfient souvent du courriel de ces serveurs.", "{ip} não tem registro PTR. Destinatários costumam desconfiar de e-mails desses servidores."),
    t("Ask whoever owns the IP address to set a PTR record.", "Demandez au propriétaire de l'adresse IP de configurer un enregistrement PTR.", "Peça ao dono do endereço IP para configurar um registro PTR."),
  ),
  "mx.ptr_not_confirmed": f(
    t("Reverse DNS does not match", "Le DNS inverse ne correspond pas", "DNS reverso não confere"),
    t("{ip} reverses to {ptr}, which does not resolve back to {ip}.", "{ip} se résout en sens inverse vers {ptr}, qui ne pointe pas vers {ip}.", "{ip} tem reverso {ptr}, que não resolve de volta para {ip}."),
    t("Make the PTR name resolve to the same address.", "Faites en sorte que le nom PTR pointe vers la même adresse.", "Faça o nome PTR resolver para o mesmo endereço."),
  ),
  "mx.single": f(
    t("Single mail server", "Un seul serveur de courriel", "Um único servidor de e-mail"),
    t("Only one MX host is listed. That is common with hosted mail.", "Un seul hôte MX est listé. C'est courant avec le courriel hébergé.", "Apenas um host MX está listado. Isso é comum com e-mail hospedado."),
  ),

  // ── SPF ─────────────────────────────────────────────────────────────────
  "spf.ok": f(
    t("SPF record is valid", "L'enregistrement SPF est valide", "O registro SPF é válido"),
    t("The SPF record parses, stays within the lookup limit and ends with -all.", "L'enregistrement SPF est lisible, respecte la limite de recherches et se termine par -all.", "O registro SPF é válido, respeita o limite de consultas e termina com -all."),
  ),
  "spf.missing": f(
    t("No SPF record", "Aucun enregistrement SPF", "Nenhum registro SPF"),
    t("Without SPF, receivers cannot tell which servers may send mail for this domain.", "Sans SPF, les destinataires ne peuvent pas savoir quels serveurs peuvent envoyer du courriel pour ce domaine.", "Sem SPF, os destinatários não sabem quais servidores podem enviar e-mails por este domínio."),
    t("Publish a TXT record starting with v=spf1 that lists every sender.", "Publiez un enregistrement TXT commençant par v=spf1 qui liste tous les expéditeurs.", "Publique um registro TXT começando com v=spf1 que liste todos os remetentes."),
  ),
  "spf.multiple": f(
    t("{count} SPF records", "{count} enregistrements SPF", "{count} registros SPF"),
    t("A domain may have only one SPF record. With more, receivers treat SPF as a permanent error.", "Un domaine ne peut avoir qu'un seul enregistrement SPF. S'il y en a plus, les destinataires traitent le SPF comme une erreur permanente.", "Um domínio só pode ter um registro SPF. Com mais, os destinatários tratam o SPF como erro permanente."),
    t("Merge them into one record.", "Fusionnez-les en un seul enregistrement.", "Junte-os em um único registro."),
  ),
  "spf.too_many_lookups": f(
    t("Too many DNS lookups", "Trop de recherches DNS", "Consultas DNS demais"),
    t("SPF needs {count} DNS lookups; receivers stop at 10 and fail the check.", "Le SPF demande {count} recherches DNS; les destinataires s'arrêtent à 10 et échouent la vérification.", "O SPF precisa de {count} consultas DNS; os destinatários param em 10 e falham a verificação."),
    t("Remove unused includes or replace some with ip4/ip6 ranges.", "Retirez les include inutiles ou remplacez-en par des plages ip4/ip6.", "Remova includes sem uso ou troque alguns por faixas ip4/ip6."),
  ),
  "spf.void_lookups": f(
    t("Lookups with no answer", "Recherches sans réponse", "Consultas sem resposta"),
    t("{count} lookups return nothing; receivers fail SPF after 2.", "{count} recherches ne renvoient rien; les destinataires échouent le SPF après 2.", "{count} consultas não retornam nada; os destinatários falham o SPF após 2."),
    t("Remove mechanisms that point to names with no records.", "Retirez les mécanismes qui pointent vers des noms sans enregistrement.", "Remova mecanismos que apontam para nomes sem registros."),
  ),
  "spf.plus_all": f(
    t("SPF allows every server", "Le SPF permet tous les serveurs", "O SPF permite qualquer servidor"),
    t("+all lets any server on the Internet send mail as this domain.", "+all permet à n'importe quel serveur d'Internet d'envoyer du courriel au nom de ce domaine.", "+all deixa qualquer servidor da Internet enviar e-mails como este domínio."),
    t("End the record with -all once every sender is listed.", "Terminez l'enregistrement par -all quand tous les expéditeurs sont listés.", "Termine o registro com -all quando todos os remetentes estiverem listados."),
  ),
  "spf.neutral_all": f(
    t("SPF ends with ?all", "Le SPF se termine par ?all", "O SPF termina com ?all"),
    t("?all says nothing about unlisted servers, so SPF gives no protection.", "?all ne dit rien des serveurs non listés; le SPF ne protège donc pas.", "?all não diz nada sobre servidores não listados, então o SPF não protege."),
    t("Use -all once every sender is listed.", "Passez à -all quand tous les expéditeurs sont listés.", "Use -all quando todos os remetentes estiverem listados."),
  ),
  "spf.softfail_all": f(
    t("SPF ends with ~all", "Le SPF se termine par ~all", "O SPF termina com ~all"),
    t("SPF ends with ~all: mail from unlisted servers is marked suspicious but still accepted.", "Le SPF se termine par ~all : le courriel d'un serveur non listé est marqué comme suspect mais accepté.", "O SPF termina com ~all: e-mails de servidores não listados são marcados como suspeitos, mas ainda aceitos."),
    t("Use -all once every sender is listed.", "Passez à -all quand tous les expéditeurs sont listés.", "Use -all quando todos os remetentes estiverem listados."),
  ),
  "spf.no_all": f(
    t("SPF has no all", "Le SPF n'a pas de all", "O SPF não tem all"),
    t("Without an all mechanism, unlisted servers get a neutral result.", "Sans mécanisme all, les serveurs non listés obtiennent un résultat neutre.", "Sem o mecanismo all, servidores não listados recebem resultado neutro."),
    t("End the record with -all.", "Terminez l'enregistrement par -all.", "Termine o registro com -all."),
  ),
  "spf.ptr": f(
    t("SPF uses ptr", "Le SPF utilise ptr", "O SPF usa ptr"),
    t("The ptr mechanism is slow and deprecated; many receivers ignore it.", "Le mécanisme ptr est lent et déconseillé; plusieurs destinataires l'ignorent.", "O mecanismo ptr é lento e obsoleto; muitos destinatários o ignoram."),
    t("Replace it with ip4/ip6 or include.", "Remplacez-le par ip4/ip6 ou include.", "Substitua por ip4/ip6 ou include."),
  ),
  "spf.unknown_mechanism": f(
    t("Unknown SPF term", "Terme SPF inconnu", "Termo SPF desconhecido"),
    t("{mechanism} is not a valid SPF term, so receivers treat the record as an error.", "{mechanism} n'est pas un terme SPF valide; les destinataires traitent l'enregistrement comme une erreur.", "{mechanism} não é um termo SPF válido, então os destinatários tratam o registro como erro."),
    t("Fix or remove that term.", "Corrigez ou retirez ce terme.", "Corrija ou remova esse termo."),
  ),
  "spf.macros": f(
    t("SPF uses macros", "Le SPF utilise des macros", "O SPF usa macros"),
    t("The record uses macros, which are evaluated per message and cannot be fully checked here.", "L'enregistrement utilise des macros, évaluées pour chaque message, qui ne peuvent pas être entièrement vérifiées ici.", "O registro usa macros, avaliadas por mensagem, que não podem ser totalmente verificadas aqui."),
  ),
  "spf.loop": f(
    t("SPF include loop", "Boucle d'include SPF", "Loop de include no SPF"),
    t("{domain} is included more than once in a loop, so SPF evaluation fails.", "{domain} est inclus plus d'une fois en boucle; l'évaluation du SPF échoue.", "{domain} é incluído mais de uma vez em loop, então a avaliação do SPF falha."),
    t("Remove the include that points back.", "Retirez l'include qui revient en arrière.", "Remova o include que aponta de volta."),
  ),
  "spf.include_missing": f(
    t("Included domain has no SPF", "Le domaine inclus n'a pas de SPF", "Domínio incluído sem SPF"),
    t("include:{domain} has no SPF record, which is a permanent error.", "include:{domain} n'a pas d'enregistrement SPF, ce qui est une erreur permanente.", "include:{domain} não tem registro SPF, o que é um erro permanente."),
    t("Fix the name or remove the include.", "Corrigez le nom ou retirez l'include.", "Corrija o nome ou remova o include."),
  ),
  "spf.oversize": f(
    t("SPF record is long", "Enregistrement SPF long", "Registro SPF longo"),
    t("The answer is {bytes} bytes, past the 512-byte UDP size; some receivers may not read it.", "La réponse fait {bytes} octets, au-delà des 512 octets UDP; certains destinataires pourraient ne pas la lire.", "A resposta tem {bytes} bytes, acima dos 512 bytes UDP; alguns destinatários podem não lê-la."),
    t("Shorten the record or move senders into an include.", "Raccourcissez l'enregistrement ou déplacez des expéditeurs dans un include.", "Encurte o registro ou mova remetentes para um include."),
  ),

  // ── DKIM ────────────────────────────────────────────────────────────────
  "dkim.ok": f(
    t("DKIM key found", "Clé DKIM trouvée", "Chave DKIM encontrada"),
    t("Selector {selector} has a {bits}-bit key.", "Le sélecteur {selector} a une clé de {bits} bits.", "O seletor {selector} tem uma chave de {bits} bits."),
  ),
  "dkim.not_found": f(
    t("No DKIM key found", "Aucune clé DKIM trouvée", "Nenhuma chave DKIM encontrada"),
    t("No key was found at the selectors tried ({selectors}). Selectors cannot be listed, so this is not proof that DKIM is missing.", "Aucune clé aux sélecteurs essayés ({selectors}). Les sélecteurs ne peuvent pas être listés; ce n'est donc pas une preuve que le DKIM manque.", "Nenhuma chave nos seletores testados ({selectors}). Seletores não podem ser listados, então isto não prova que o DKIM falta."),
    t("Check again with the selector from a message's DKIM-Signature header (s=).", "Vérifiez de nouveau avec le sélecteur de l'en-tête DKIM-Signature d'un message (s=).", "Verifique de novo com o seletor do cabeçalho DKIM-Signature de uma mensagem (s=)."),
  ),
  "dkim.revoked": f(
    t("DKIM key revoked", "Clé DKIM révoquée", "Chave DKIM revogada"),
    t("Selector {selector} has an empty key, which means it was revoked.", "Le sélecteur {selector} a une clé vide, ce qui veut dire qu'elle a été révoquée.", "O seletor {selector} tem a chave vazia, o que significa que foi revogada."),
  ),
  "dkim.testing": f(
    t("DKIM in testing mode", "DKIM en mode test", "DKIM em modo de teste"),
    t("Selector {selector} has t=y, so receivers may ignore its signatures.", "Le sélecteur {selector} a t=y; les destinataires peuvent ignorer ses signatures.", "O seletor {selector} tem t=y, então os destinatários podem ignorar suas assinaturas."),
    t("Remove t=y once signing works.", "Retirez t=y quand la signature fonctionne.", "Remova t=y quando a assinatura estiver funcionando."),
  ),
  "dkim.weak_key": f(
    t("DKIM key is {bits}-bit", "La clé DKIM fait {bits} bits", "A chave DKIM tem {bits} bits"),
    t("Keys under 2048 bits are considered weak and some receivers distrust them.", "Les clés de moins de 2048 bits sont jugées faibles et certains destinataires s'en méfient.", "Chaves com menos de 2048 bits são consideradas fracas e alguns destinatários desconfiam delas."),
    t("Rotate to a 2048-bit key.", "Passez à une clé de 2048 bits.", "Troque por uma chave de 2048 bits."),
  ),
  "dkim.bad_record": f(
    t("DKIM record is invalid", "Enregistrement DKIM non valide", "Registro DKIM inválido"),
    t("The record at selector {selector} cannot be read as a DKIM key.", "L'enregistrement du sélecteur {selector} ne peut pas être lu comme une clé DKIM.", "O registro no seletor {selector} não pode ser lido como chave DKIM."),
    t("Copy the record again from the mail service.", "Copiez de nouveau l'enregistrement depuis le service de courriel.", "Copie o registro novamente do serviço de e-mail."),
  ),

  // ── DMARC ───────────────────────────────────────────────────────────────
  "dmarc.missing": f(
    t("No DMARC record", "Aucun enregistrement DMARC", "Nenhum registro DMARC"),
    t("Without DMARC, receivers have no policy for mail that fails SPF and DKIM, and nobody gets reports.", "Sans DMARC, les destinataires n'ont aucune politique pour le courriel qui échoue au SPF et au DKIM, et personne ne reçoit de rapports.", "Sem DMARC, os destinatários não têm política para e-mails que falham no SPF e DKIM, e ninguém recebe relatórios."),
    t("Publish _dmarc with p=none and a rua address, then tighten the policy.", "Publiez _dmarc avec p=none et une adresse rua, puis resserrez la politique.", "Publique _dmarc com p=none e um endereço rua, depois endureça a política."),
  ),
  "dmarc.multiple": f(
    t("Several DMARC records", "Plusieurs enregistrements DMARC", "Vários registros DMARC"),
    t("With more than one record, receivers ignore DMARC entirely.", "Avec plus d'un enregistrement, les destinataires ignorent complètement le DMARC.", "Com mais de um registro, os destinatários ignoram o DMARC totalmente."),
    t("Keep a single record.", "Gardez un seul enregistrement.", "Mantenha um único registro."),
  ),
  "dmarc.policy_none": f(
    t("DMARC policy is none", "La politique DMARC est none", "A política DMARC é none"),
    t("DMARC policy is none: reports only, spoofed mail is still delivered.", "La politique DMARC est none : rapports seulement, le courriel usurpé est encore livré.", "A política DMARC é none: só relatórios, e-mails falsificados ainda são entregues."),
    t("Move to p=quarantine, then p=reject, once reports show every sender passes.", "Passez à p=quarantine, puis à p=reject, quand les rapports montrent que tous les expéditeurs passent.", "Passe para p=quarantine e depois p=reject quando os relatórios mostrarem que todos os remetentes passam."),
  ),
  "dmarc.policy_quarantine": f(
    t("DMARC policy is quarantine", "La politique DMARC est quarantine", "A política DMARC é quarantine"),
    t("Mail that fails DMARC goes to spam.", "Le courriel qui échoue au DMARC va dans les indésirables.", "E-mails que falham no DMARC vão para o spam."),
  ),
  "dmarc.policy_reject": f(
    t("DMARC policy is reject", "La politique DMARC est reject", "A política DMARC é reject"),
    t("Mail that fails DMARC is refused. This is the strongest protection.", "Le courriel qui échoue au DMARC est refusé. C'est la protection la plus forte.", "E-mails que falham no DMARC são recusados. É a proteção mais forte."),
  ),
  "dmarc.pct_partial": f(
    t("Policy applies to {pct}%", "Politique appliquée à {pct} %", "Política aplicada a {pct}%"),
    t("pct={pct}: the policy applies to only part of failing mail.", "pct={pct} : la politique ne s'applique qu'à une partie du courriel en échec.", "pct={pct}: a política se aplica só a parte dos e-mails com falha."),
    t("Raise pct to 100 once reports are clean.", "Montez pct à 100 quand les rapports sont propres.", "Aumente pct para 100 quando os relatórios estiverem limpos."),
  ),
  "dmarc.no_rua": f(
    t("No DMARC reports address", "Aucune adresse de rapports DMARC", "Nenhum endereço de relatórios DMARC"),
    t("Without rua, nobody sees who sends mail as this domain.", "Sans rua, personne ne voit qui envoie du courriel au nom de ce domaine.", "Sem rua, ninguém vê quem envia e-mails como este domínio."),
    t("Add rua=mailto: with a mailbox that reads aggregate reports.", "Ajoutez rua=mailto: avec une boîte qui lit les rapports agrégés.", "Adicione rua=mailto: com uma caixa que leia relatórios agregados."),
  ),
  "dmarc.rua_unauthorized": f(
    t("Reports address not authorized", "Adresse de rapports non autorisée", "Endereço de relatórios não autorizado"),
    t("{host} has not authorized reports for this domain, so receivers will not send them.", "{host} n'a pas autorisé les rapports pour ce domaine; les destinataires ne les enverront pas.", "{host} não autorizou relatórios para este domínio, então os destinatários não os enviarão."),
    t("Ask the report provider to publish the authorization record.", "Demandez au fournisseur de rapports de publier l'enregistrement d'autorisation.", "Peça ao provedor de relatórios para publicar o registro de autorização."),
  ),
  "dmarc.inherited": f(
    t("DMARC inherited", "DMARC hérité", "DMARC herdado"),
    t("No record on this name; the policy of {domain} applies.", "Aucun enregistrement sur ce nom; la politique de {domain} s'applique.", "Nenhum registro neste nome; a política de {domain} se aplica."),
  ),
  "dmarc.bad_record": f(
    t("DMARC record is invalid", "Enregistrement DMARC non valide", "Registro DMARC inválido"),
    t("The record cannot be read: {reason}.", "L'enregistrement ne peut pas être lu : {reason}.", "O registro não pode ser lido: {reason}."),
    t("Start the record with v=DMARC1; p=", "Commencez l'enregistrement par v=DMARC1; p=", "Comece o registro com v=DMARC1; p="),
  ),

  // ── Blacklists (DNSBL) ──────────────────────────────────────────────────
  "dnsbl.clean": f(
    t("Not listed", "Non listé", "Não listado"),
    t("Not listed on any of the {count} lists checked.", "Non listé sur aucune des {count} listes vérifiées.", "Não listado em nenhuma das {count} listas verificadas."),
  ),
  "dnsbl.listed": f(
    t("Listed on {zone}", "Listé sur {zone}", "Listado em {zone}"),
    t("{ip} is on a major blacklist; many receivers will refuse its mail.", "{ip} est sur une liste noire majeure; plusieurs destinataires refuseront son courriel.", "{ip} está em uma lista negra importante; muitos destinatários recusarão seus e-mails."),
    t("Find and stop the cause, then ask the list to delist it.", "Trouvez et arrêtez la cause, puis demandez le retrait à la liste.", "Encontre e elimine a causa, depois peça a remoção à lista."),
  ),
  "dnsbl.listed_minor": f(
    t("Listed on {zone}", "Listé sur {zone}", "Listado em {zone}"),
    t("{ip} is on a smaller list that few receivers use.", "{ip} est sur une liste moins utilisée par les destinataires.", "{ip} está em uma lista menor que poucos destinatários usam."),
    t("Check for a cause, then request delisting if needed.", "Cherchez une cause, puis demandez le retrait au besoin.", "Procure uma causa e peça a remoção se necessário."),
  ),
  "dnsbl.unknown": f(
    t("{zone} did not answer", "{zone} n'a pas répondu", "{zone} não respondeu"),
    t("The list did not answer in time, so the result for this list is unknown.", "La liste n'a pas répondu à temps; le résultat pour cette liste est inconnu.", "A lista não respondeu a tempo, então o resultado desta lista é desconhecido."),
  ),
  "dnsbl.refused": f(
    t("{zone} refused the query", "{zone} a refusé la requête", "{zone} recusou a consulta"),
    t("The list refused to answer this server's resolver. This says nothing about the address.", "La liste a refusé de répondre au résolveur de ce serveur. Cela ne dit rien sur l'adresse.", "A lista se recusou a responder ao resolvedor deste servidor. Isto não diz nada sobre o endereço."),
  ),
  "dnsbl.ipv6_skipped": f(
    t("IPv6 not checked", "IPv6 non vérifiée", "IPv6 não verificado"),
    t("Blacklists for IPv6 addresses are not checked yet.", "Les listes noires pour les adresses IPv6 ne sont pas encore vérifiées.", "Listas negras para endereços IPv6 ainda não são verificadas."),
  ),

  // ── TLS ─────────────────────────────────────────────────────────────────
  "tls.ok": f(
    t("Certificate is valid", "Le certificat est valide", "O certificado é válido"),
    t("Trusted, matches the name, and valid for {days} more days.", "Approuvé, correspond au nom et valide encore {days} jours.", "Confiável, corresponde ao nome e válido por mais {days} dias."),
  ),
  "tls.expired": f(
    t("Certificate expired", "Certificat expiré", "Certificado expirado"),
    t("The certificate expired on {date}. Browsers and mail servers refuse it.", "Le certificat a expiré le {date}. Les navigateurs et les serveurs de courriel le refusent.", "O certificado expirou em {date}. Navegadores e servidores de e-mail o recusam."),
    t("Renew and install a new certificate.", "Renouvelez et installez un nouveau certificat.", "Renove e instale um novo certificado."),
  ),
  "tls.not_yet_valid": f(
    t("Certificate not yet valid", "Certificat pas encore valide", "Certificado ainda não válido"),
    t("The certificate starts on {date}.", "Le certificat commence le {date}.", "O certificado começa em {date}."),
    t("Check the server clock or install the current certificate.", "Vérifiez l'horloge du serveur ou installez le certificat en vigueur.", "Verifique o relógio do servidor ou instale o certificado vigente."),
  ),
  "tls.name_mismatch": f(
    t("Name does not match", "Le nom ne correspond pas", "O nome não corresponde"),
    t("The certificate does not cover {host}.", "Le certificat ne couvre pas {host}.", "O certificado não cobre {host}."),
    t("Issue a certificate that includes this name.", "Émettez un certificat qui inclut ce nom.", "Emita um certificado que inclua este nome."),
  ),
  "tls.self_signed": f(
    t("Self-signed certificate", "Certificat autosigné", "Certificado autoassinado"),
    t("No trusted authority issued this certificate, so clients refuse it.", "Aucune autorité de confiance n'a émis ce certificat; les clients le refusent.", "Nenhuma autoridade confiável emitiu este certificado, então os clientes o recusam."),
    t("Install a certificate from a public authority.", "Installez un certificat d'une autorité publique.", "Instale um certificado de uma autoridade pública."),
  ),
  "tls.incomplete_chain": f(
    t("Incomplete chain", "Chaîne incomplète", "Cadeia incompleta"),
    t("The server does not send the intermediate certificate; some clients cannot verify it.", "Le serveur n'envoie pas le certificat intermédiaire; certains clients ne peuvent pas le vérifier.", "O servidor não envia o certificado intermediário; alguns clientes não conseguem verificá-lo."),
    t("Install the full chain (certificate plus intermediates).", "Installez la chaîne complète (certificat et intermédiaires).", "Instale a cadeia completa (certificado e intermediários)."),
  ),
  "tls.untrusted": f(
    t("Certificate not trusted", "Certificat non approuvé", "Certificado não confiável"),
    t("The certificate could not be verified: {reason}.", "Le certificat n'a pas pu être vérifié : {reason}.", "O certificado não pôde ser verificado: {reason}."),
  ),
  "tls.expires_soon": f(
    t("Expires in {days} days", "Expire dans {days} jours", "Expira em {days} dias"),
    t("The certificate expires on {date}, in under 14 days.", "Le certificat expire le {date}, dans moins de 14 jours.", "O certificado expira em {date}, em menos de 14 dias."),
    t("Renew it now.", "Renouvelez-le maintenant.", "Renove agora."),
  ),
  "tls.expires_30": f(
    t("Expires in {days} days", "Expire dans {days} jours", "Expira em {days} dias"),
    t("The certificate expires on {date}, in under 30 days.", "Le certificat expire le {date}, dans moins de 30 jours.", "O certificado expira em {date}, em menos de 30 dias."),
    t("Plan the renewal, or check that automatic renewal works.", "Planifiez le renouvellement ou vérifiez que le renouvellement automatique fonctionne.", "Planeje a renovação ou confira se a renovação automática funciona."),
  ),
  "tls.sha1": f(
    t("SHA-1 signature", "Signature SHA-1", "Assinatura SHA-1"),
    t("The certificate is signed with SHA-1, which is no longer trusted.", "Le certificat est signé en SHA-1, qui n'est plus jugé sûr.", "O certificado é assinado com SHA-1, que não é mais confiável."),
    t("Reissue it with SHA-256.", "Émettez-le de nouveau en SHA-256.", "Emita novamente com SHA-256."),
  ),
  "tls.weak_key": f(
    t("{bits}-bit key", "Clé de {bits} bits", "Chave de {bits} bits"),
    t("RSA keys under 2048 bits are weak.", "Les clés RSA de moins de 2048 bits sont faibles.", "Chaves RSA com menos de 2048 bits são fracas."),
    t("Reissue the certificate with a 2048-bit key or larger.", "Émettez de nouveau le certificat avec une clé de 2048 bits ou plus.", "Emita novamente o certificado com chave de 2048 bits ou mais."),
  ),
  "tls.legacy_protocol": f(
    t("{protocol} accepted", "{protocol} accepté", "{protocol} aceito"),
    t("The server still accepts {protocol}, which is obsolete.", "Le serveur accepte encore {protocol}, qui est désuet.", "O servidor ainda aceita {protocol}, que é obsoleto."),
    t("Allow only TLS 1.2 and 1.3.", "Permettez seulement TLS 1.2 et 1.3.", "Permita apenas TLS 1.2 e 1.3."),
  ),
  "tls.legacy_unknown": f(
    t("Old protocols not tested", "Anciens protocoles non testés", "Protocolos antigos não testados"),
    t("This server cannot offer TLS 1.0 or 1.1, so their support is unknown.", "Ce serveur ne peut pas offrir TLS 1.0 ou 1.1; leur prise en charge est inconnue.", "Este servidor não consegue oferecer TLS 1.0 ou 1.1, então o suporte a eles é desconhecido."),
  ),
  "tls.connect_failed": f(
    t("Could not connect", "Connexion impossible", "Não foi possível conectar"),
    t("No TLS connection to {host} on port {port}: {reason}.", "Aucune connexion TLS à {host} sur le port {port} : {reason}.", "Sem conexão TLS com {host} na porta {port}: {reason}."),
  ),

  // ── Domain info (RDAP) ──────────────────────────────────────────────────
  "rdap.ok": f(
    t("Registration found", "Enregistrement trouvé", "Registro encontrado"),
    t("Registered with {registrar}; expires on {date}.", "Enregistré chez {registrar}; expire le {date}.", "Registrado em {registrar}; expira em {date}."),
  ),
  "rdap.expires_soon": f(
    t("Domain expires in {days} days", "Le domaine expire dans {days} jours", "O domínio expira em {days} dias"),
    t("The domain expires on {date}. Once it lapses, the site and mail stop.", "Le domaine expire le {date}. S'il n'est pas renouvelé, le site et le courriel s'arrêtent.", "O domínio expira em {date}. Se vencer, o site e o e-mail param."),
    t("Renew it at the registrar now.", "Renouvelez-le maintenant chez le registraire.", "Renove agora no registrador."),
  ),
  "rdap.expires_30": f(
    t("Domain expires in {days} days", "Le domaine expire dans {days} jours", "O domínio expira em {days} dias"),
    t("The domain expires on {date}.", "Le domaine expire le {date}.", "O domínio expira em {date}."),
    t("Renew it, or turn on automatic renewal.", "Renouvelez-le ou activez le renouvellement automatique.", "Renove ou ative a renovação automática."),
  ),
  "rdap.hold": f(
    t("Domain on hold ({status})", "Domaine suspendu ({status})", "Domínio suspenso ({status})"),
    t("The domain is not published in DNS, so the site and mail do not work.", "Le domaine n'est pas publié dans le DNS; le site et le courriel ne fonctionnent pas.", "O domínio não é publicado no DNS, então o site e o e-mail não funcionam."),
    t("Contact the registrar to find out why.", "Communiquez avec le registraire pour savoir pourquoi.", "Fale com o registrador para saber o motivo."),
  ),
  "rdap.redemption": f(
    t("Domain in redemption", "Domaine en période de rachat", "Domínio em período de resgate"),
    t("The domain expired and can still be restored, usually for a fee.", "Le domaine a expiré et peut encore être récupéré, habituellement moyennant des frais.", "O domínio expirou e ainda pode ser restaurado, geralmente mediante taxa."),
    t("Restore it at the registrar right away.", "Récupérez-le tout de suite chez le registraire.", "Restaure imediatamente no registrador."),
  ),
  "rdap.pending_delete": f(
    t("Domain about to be deleted", "Domaine sur le point d'être supprimé", "Domínio prestes a ser excluído"),
    t("The domain will be deleted and released to anyone.", "Le domaine sera supprimé et offert à tous.", "O domínio será excluído e liberado para qualquer pessoa."),
  ),
  "rdap.no_transfer_lock": f(
    t("No transfer lock", "Aucun verrou de transfert", "Sem bloqueio de transferência"),
    t("clientTransferProhibited is not set, so a transfer could start without an extra step.", "clientTransferProhibited n'est pas activé; un transfert pourrait commencer sans étape de plus.", "clientTransferProhibited não está ativo, então uma transferência pode começar sem etapa extra."),
    t("Turn on the transfer lock at the registrar.", "Activez le verrou de transfert chez le registraire.", "Ative o bloqueio de transferência no registrador."),
  ),
  "rdap.dnssec_signed": f(
    t("DNSSEC signed", "Signé DNSSEC", "Assinado com DNSSEC"),
    t("The registry publishes DNSSEC keys for this domain.", "Le registre publie des clés DNSSEC pour ce domaine.", "O registro publica chaves DNSSEC para este domínio."),
  ),
  "rdap.dnssec_unsigned": f(
    t("DNSSEC not enabled", "DNSSEC non activé", "DNSSEC não ativado"),
    t("The domain is not signed with DNSSEC.", "Le domaine n'est pas signé avec DNSSEC.", "O domínio não é assinado com DNSSEC."),
  ),
  "rdap.no_service": f(
    t("No RDAP service for this TLD", "Aucun service RDAP pour ce domaine de premier niveau", "Nenhum serviço RDAP para este TLD"),
    t("The .{tld} registry offers no RDAP service, so registration details are not available here.", "Le registre .{tld} n'offre aucun service RDAP; les détails d'enregistrement ne sont pas disponibles ici.", "O registro .{tld} não oferece serviço RDAP, então os detalhes de registro não estão disponíveis aqui."),
  ),
  "rdap.not_found": f(
    t("Domain not registered", "Domaine non enregistré", "Domínio não registrado"),
    t("The registry has no record of {domain}.", "Le registre n'a aucune trace de {domain}.", "O registro não tem dados de {domain}."),
  ),

  // ── HTTP headers ────────────────────────────────────────────────────────
  "http.ok": f(
    t("Security headers in place", "En-têtes de sécurité en place", "Cabeçalhos de segurança presentes"),
    t("HTTPS, HSTS and the main security headers are set.", "HTTPS, HSTS et les principaux en-têtes de sécurité sont en place.", "HTTPS, HSTS e os principais cabeçalhos de segurança estão definidos."),
  ),
  "http.status": f(
    t("HTTP {status}", "HTTP {status}", "HTTP {status}"),
    t("The final answer is status {status}.", "La réponse finale a le statut {status}.", "A resposta final tem status {status}."),
  ),
  "http.no_https_redirect": f(
    t("No redirect to HTTPS", "Aucune redirection vers HTTPS", "Sem redirecionamento para HTTPS"),
    t("The http address does not redirect to https, so visitors may stay on an unencrypted page.", "L'adresse http ne redirige pas vers https; les visiteurs peuvent rester sur une page non chiffrée.", "O endereço http não redireciona para https, então visitantes podem ficar numa página sem criptografia."),
    t("Redirect all http requests to https.", "Redirigez toutes les requêtes http vers https.", "Redirecione todas as requisições http para https."),
  ),
  "http.hsts_missing": f(
    t("No HSTS", "Aucun HSTS", "Sem HSTS"),
    t("Without Strict-Transport-Security, browsers may still try http first.", "Sans Strict-Transport-Security, les navigateurs peuvent encore essayer http en premier.", "Sem Strict-Transport-Security, os navegadores ainda podem tentar http primeiro."),
    t("Add Strict-Transport-Security: max-age=31536000; includeSubDomains.", "Ajoutez Strict-Transport-Security: max-age=31536000; includeSubDomains.", "Adicione Strict-Transport-Security: max-age=31536000; includeSubDomains."),
  ),
  "http.hsts_short": f(
    t("HSTS too short", "HSTS trop court", "HSTS curto demais"),
    t("HSTS lasts {days} days; at least 180 days is recommended.", "Le HSTS dure {days} jours; au moins 180 jours sont recommandés.", "O HSTS dura {days} dias; recomenda-se pelo menos 180 dias."),
    t("Raise max-age to 31536000.", "Montez max-age à 31536000.", "Aumente max-age para 31536000."),
  ),
  "http.csp_missing": f(
    t("No Content-Security-Policy", "Aucune Content-Security-Policy", "Sem Content-Security-Policy"),
    t("A CSP limits what scripts a page may load and reduces the impact of injected code.", "Une CSP limite les scripts qu'une page peut charger et réduit l'effet du code injecté.", "Uma CSP limita os scripts que a página pode carregar e reduz o impacto de código injetado."),
    t("Add a Content-Security-Policy header suited to the site.", "Ajoutez un en-tête Content-Security-Policy adapté au site.", "Adicione um cabeçalho Content-Security-Policy adequado ao site."),
  ),
  "http.no_clickjacking": f(
    t("No clickjacking protection", "Aucune protection contre le détournement de clic", "Sem proteção contra clickjacking"),
    t("Neither X-Frame-Options nor CSP frame-ancestors is set, so other sites can frame this page.", "Ni X-Frame-Options ni frame-ancestors de la CSP n'est en place; d'autres sites peuvent encadrer cette page.", "Nem X-Frame-Options nem frame-ancestors da CSP está definido, então outros sites podem enquadrar esta página."),
    t("Add X-Frame-Options: DENY or frame-ancestors 'self'.", "Ajoutez X-Frame-Options: DENY ou frame-ancestors 'self'.", "Adicione X-Frame-Options: DENY ou frame-ancestors 'self'."),
  ),
  "http.no_nosniff": f(
    t("No X-Content-Type-Options", "Aucun X-Content-Type-Options", "Sem X-Content-Type-Options"),
    t("Without nosniff, browsers may guess file types and run content as script.", "Sans nosniff, les navigateurs peuvent deviner le type des fichiers et exécuter du contenu comme script.", "Sem nosniff, os navegadores podem adivinhar o tipo de arquivo e executar conteúdo como script."),
    t("Add X-Content-Type-Options: nosniff.", "Ajoutez X-Content-Type-Options: nosniff.", "Adicione X-Content-Type-Options: nosniff."),
  ),
  "http.no_referrer_policy": f(
    t("No Referrer-Policy", "Aucune Referrer-Policy", "Sem Referrer-Policy"),
    t("Browsers use their default, which may send full addresses to other sites.", "Les navigateurs utilisent leur valeur par défaut, qui peut envoyer l'adresse complète à d'autres sites.", "Os navegadores usam o padrão, que pode enviar endereços completos a outros sites."),
    t("Add Referrer-Policy: strict-origin-when-cross-origin.", "Ajoutez Referrer-Policy: strict-origin-when-cross-origin.", "Adicione Referrer-Policy: strict-origin-when-cross-origin."),
  ),
  "http.version_disclosure": f(
    t("Software version shown", "Version du logiciel affichée", "Versão do software exposta"),
    t("The {header} header reveals \"{value}\", which helps attackers target known flaws.", "L'en-tête {header} révèle « {value} », ce qui aide à cibler des failles connues.", "O cabeçalho {header} revela \"{value}\", o que ajuda a explorar falhas conhecidas."),
    t("Hide the version in the server settings.", "Masquez la version dans les réglages du serveur.", "Oculte a versão nas configurações do servidor."),
  ),
  "http.insecure_cookie": f(
    t("Cookie missing flags", "Témoin sans attributs de sécurité", "Cookie sem atributos de segurança"),
    t("Cookie {cookie} lacks {flags}.", "Le témoin {cookie} n'a pas {flags}.", "O cookie {cookie} não tem {flags}."),
    t("Set Secure, HttpOnly and SameSite on cookies.", "Ajoutez Secure, HttpOnly et SameSite aux témoins.", "Defina Secure, HttpOnly e SameSite nos cookies."),
  ),
  "http.redirect_refused": f(
    t("Redirect not followed", "Redirection non suivie", "Redirecionamento não seguido"),
    t("A redirect pointed to a private or refused address and was not followed.", "Une redirection pointait vers une adresse privée ou refusée et n'a pas été suivie.", "Um redirecionamento apontava para um endereço privado ou recusado e não foi seguido."),
  ),

  // ── Email header analyzer ───────────────────────────────────────────────
  "hdr.auth_pass": f(
    t("Authentication passed", "Authentification réussie", "Autenticação aprovada"),
    t("SPF, DKIM and DMARC passed at the receiving server.", "SPF, DKIM et DMARC ont réussi au serveur de réception.", "SPF, DKIM e DMARC passaram no servidor de recebimento."),
  ),
  "hdr.spf_fail": f(
    t("SPF failed", "SPF en échec", "SPF falhou"),
    t("The receiving server reported spf={result} for {domain}.", "Le serveur de réception a indiqué spf={result} pour {domain}.", "O servidor de recebimento informou spf={result} para {domain}."),
  ),
  "hdr.dkim_fail": f(
    t("DKIM failed", "DKIM en échec", "DKIM falhou"),
    t("The receiving server reported dkim={result} for {domain}.", "Le serveur de réception a indiqué dkim={result} pour {domain}.", "O servidor de recebimento informou dkim={result} para {domain}."),
  ),
  "hdr.dmarc_fail": f(
    t("DMARC failed", "DMARC en échec", "DMARC falhou"),
    t("The receiving server reported dmarc={result} for {domain}.", "Le serveur de réception a indiqué dmarc={result} pour {domain}.", "O servidor de recebimento informou dmarc={result} para {domain}."),
  ),
  "hdr.no_auth_results": f(
    t("No authentication results", "Aucun résultat d'authentification", "Sem resultados de autenticação"),
    t("The headers carry no Authentication-Results, so the receiver's verdict is not known.", "Les en-têtes ne contiennent aucun Authentication-Results; le verdict du destinataire est inconnu.", "Os cabeçalhos não têm Authentication-Results, então o veredito do destinatário é desconhecido."),
  ),
  "hdr.misaligned": f(
    t("From domain not aligned", "Domaine From non aligné", "Domínio From não alinhado"),
    t("From is {from}, but {source} is {domain}.", "From est {from}, mais {source} est {domain}.", "From é {from}, mas {source} é {domain}."),
  ),
  "hdr.reply_to_differs": f(
    t("Reply-To on another domain", "Reply-To sur un autre domaine", "Reply-To em outro domínio"),
    t("Replies go to {domain}, not the sender's domain. Common in phishing.", "Les réponses vont à {domain}, pas au domaine de l'expéditeur. Fréquent en hameçonnage.", "As respostas vão para {domain}, não para o domínio do remetente. Comum em phishing."),
  ),
  "hdr.hop_delay": f(
    t("Slow hop", "Relais lent", "Salto lento"),
    t("Hop {hop} took {minutes} min.", "Le relais {hop} a pris {minutes} min.", "O salto {hop} levou {minutes} min."),
  ),
  "hdr.lookalike": f(
    t("Lookalike sender", "Expéditeur imitateur", "Remetente imitador"),
    t("The display name \"{name}\" looks like another address or brand than the one that sent it.", "Le nom affiché « {name} » ressemble à une autre adresse ou marque que celle qui l'a envoyé.", "O nome exibido \"{name}\" parece outro endereço ou marca diferente de quem enviou."),
  ),
  "hdr.dkim_not_reverified": f(
    t("DKIM not re-verified", "DKIM non revérifié", "DKIM não reverificado"),
    t("DKIM signatures cannot be checked again without the message body; the receiver's results are shown.", "Les signatures DKIM ne peuvent pas être revérifiées sans le corps du message; les résultats du destinataire sont affichés.", "As assinaturas DKIM não podem ser verificadas de novo sem o corpo da mensagem; os resultados do destinatário são exibidos."),
  ),
};

/** Fill {placeholders}; a missing one reads "?". */
export function netFill(template: string, params: NetFindingParams = {}): string {
  return template.replace(/\{([a-zA-Z_]+)\}/g, (_whole, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : "?"));
}

export function netText(text: NetText, language: NetLanguage, params?: NetFindingParams): string {
  return netFill(text[language] || text.en, params);
}

/** A detail table's label or column in a language; unknown keys as they are. */
export function netDetailLabel(key: string, language: NetLanguage): string {
  return Object.hasOwn(NET_DETAIL_LABELS, key) ? NET_DETAIL_LABELS[key][language] : key;
}

export interface NetFindingWords {
  title: string;
  text: string;
  fix?: string;
}

/** A finding in words. An unknown code still reads as something: its code. */
export function netFindingWords(finding: NetFinding, language: NetLanguage): NetFindingWords {
  const entry = Object.hasOwn(NET_FINDINGS, finding.code) ? NET_FINDINGS[finding.code] : undefined;
  if (!entry) return { title: finding.code, text: "" };
  const words: NetFindingWords = { title: netText(entry.title, language, finding.params), text: netText(entry.text, language, finding.params) };
  if (entry.fix) words.fix = netText(entry.fix, language, finding.params);
  return words;
}
