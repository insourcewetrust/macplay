// Evidence summary shown in the "Guide" tab. Keep it short, concrete, sourced.
// Style: tutoiement, no jargon without explanation, numbers when they help.

export type Block =
  | { p: string }
  | { h: string }
  | { list: string[] }
  | { table: { head: string[]; rows: string[][] } }
  | { callout: string; tone?: "info" | "warn" | "tip" }
  | { refs: string[] };

export interface Article {
  id: string;
  title: string;
  kicker: string;
  icon: string;
  tone: "sun" | "sleep" | "mela" | "coffee" | "shade" | "accent";
  minutes: number;
  blocks: Block[];
}

export const ARTICLES: Article[] = [
  {
    id: "horloge",
    title: "Ce qui se passe dans ton corps",
    kicker: "Les bases",
    icon: "clock",
    tone: "accent",
    minutes: 2,
    blocks: [
      { p: "Tu as une horloge interne qui tourne sur un peu plus de 24 h (environ 24 h 12 en moyenne). Elle règle ton sommeil, ta température, ta faim, ta concentration. Quand tu changes de fuseau, ta montre saute de plusieurs heures d'un coup, ton horloge non : elle rattrape petit à petit." },
      { h: "À quelle vitesse ?" },
      { list: [
        "Vers l'est (ex. Paris → Tokyo) : environ 1 h par jour sans rien faire. Il faut avancer l'horloge, c'est plus dur.",
        "Vers l'ouest (ex. Paris → New York) : environ 1 h 30 par jour. Retarder est plus naturel, puisque ton horloge tourne déjà un peu plus lentement que 24 h.",
        "Ce sont des moyennes : les écarts entre personnes sont grands, et tout dépend de la lumière que tu prends (ou pas) sur place.",
      ] },
      { h: "Le repère clé : le point bas de température" },
      { p: "Environ 2 h 30 avant ton réveil habituel, ta température corporelle atteint son minimum. C'est la charnière de tout le plan : la lumière reçue avant ce moment retarde ton horloge, la lumière reçue après l'avance. Fuseau calcule ce point chaque jour et te dit quand chercher ou éviter la lumière." },
      { callout: "Au-delà de 9 à 10 fuseaux vers l'est, ton horloge risque de partir dans le mauvais sens si tu prends la lumière du matin trop tôt. Dans ce cas, Fuseau planifie plutôt un recul de l'horloge : c'est plus long sur le papier mais bien plus confortable.", tone: "info" },
      { refs: ["Waterhouse J. et al., Lancet 2007", "Eastman C.I. & Burgess H.J., Sleep Med Clin 2009", "Roach G.D. & Sargent C., Front Physiol 2019"] },
    ],
  },
  {
    id: "lumiere",
    title: "La lumière, ton meilleur levier",
    kicker: "Le plus important",
    icon: "sun",
    tone: "sun",
    minutes: 3,
    blocks: [
      { p: "La lumière est le signal le plus puissant pour recaler ton horloge. Le même rayon de soleil peut t'aider ou te plomber selon l'heure de ton corps. D'où les deux consignes du plan : « Cherche la lumière » et « Évite la lumière vive »." },
      { h: "Combien de lumière ?" },
      { table: { head: ["Situation", "Lumière (lux)"], rows: [
        ["Salon, bureau, terminal d'aéroport", "100 à 500"],
        ["Dehors, ciel couvert", "1 000 à 10 000"],
        ["Dehors, plein soleil", "50 000 à 100 000"],
      ] } },
      { p: "Traduction : 30 minutes dehors, même par temps gris, valent bien plus qu'une journée entière à l'intérieur. Pas besoin de fixer le soleil, être dehors suffit." },
      { h: "Dans les transports" },
      { list: [
        "VTC, taxi : les vitres (surtout teintées) filtrent une bonne partie de la lumière. Pour en prendre, assieds-toi côté fenêtre et, si tu peux, marche 10 minutes avant ou après.",
        "Pour en éviter : lunettes de soleil dans la voiture, casquette, côté ombre, yeux fermés. Ça a l'air excessif, c'est efficace.",
        "Aéroport : les baies vitrées donnent beaucoup plus de lumière que les couloirs ou les salons. Choisis ta place en fonction du plan.",
        "Avion : le hublot et la lumière de lecture sont tes interrupteurs. Masque sur les yeux quand il faut éviter.",
      ] },
      { h: "Lunettes de soleil" },
      { p: "C'est l'outil le plus sous-estimé. Des lunettes bien couvrantes (catégorie 3) coupent l'essentiel de la lumière vive. Garde-les dans le sac cabine, pas en soute." },
      { h: "Lunettes de luminothérapie (Luminette, AYO, Re-Timer…)" },
      { p: "Elles décalent bien l'horloge en laboratoire (une étude Re-Timer : environ 45 minutes de recul après deux soirées). Il n'existe pas encore d'essai solide sur le décalage horaire lui-même. Pratiques quand tu es coincé(e) à l'intérieur ou qu'il fait nuit dehors pendant une fenêtre « cherche la lumière »." },
      { callout: "Les écrans comptent peu comparés au soleil, mais en soirée « évite la lumière », passe-les en mode nuit et baisse la luminosité.", tone: "tip" },
      { refs: ["Khalsa S.B. et al., J Physiol 2003 (courbe de réponse à la lumière)", "St Hilaire M.A. et al., J Physiol 2012", "Brown T.M. et al., PLoS Biol 2022 (recommandations d'exposition)", "Lack L. & Wright H., Sleep Biol Rhythms 2015 (Re-Timer)"] },
    ],
  },
  {
    id: "melatonine",
    title: "Mélatonine : bien s'en servir",
    kicker: "Optionnel mais utile",
    icon: "pill",
    tone: "mela",
    minutes: 3,
    blocks: [
      { p: "La mélatonine est l'hormone qui dit à ton corps « c'est le soir ». Prise au bon moment, elle aide à recaler l'horloge et à s'endormir. Une revue Cochrane (10 essais) conclut qu'elle réduit le décalage horaire, surtout à partir de 5 fuseaux et vers l'est." },
      { h: "La bonne dose" },
      { list: [
        "0,5 à 1 mg suffit pour déplacer l'horloge. Une étude montre que 0,5 mg déplace autant que 3 mg, avec moins de somnolence le lendemain.",
        "Des doses plus fortes (jusqu'à 5 mg) aident un peu plus à s'endormir, mais n'en fais pas une habitude.",
        "Évite les formes à libération prolongée pour le décalage : elles marchent moins bien dans les essais.",
      ] },
      { h: "Le bon moment" },
      { list: [
        "Vers l'est : 30 minutes avant ton coucher à l'heure locale, les premiers soirs. Fuseau te le rappelle.",
        "Vers l'ouest : en général inutile. Seule exception, si tu te réveilles en pleine nuit et qu'il reste au moins 5 h avant ton réveil.",
        "Jamais le matin quand tu dois avancer ton horloge : elle la retarderait.",
      ] },
      { h: "En France" },
      { list: [
        "En complément alimentaire, la dose est limitée à moins de 2 mg par jour (souvent 1 ou 1,9 mg). Au-delà, c'est un médicament.",
        "Circadin 2 mg (libération prolongée) est sur ordonnance.",
        "Aux États-Unis, c'est vendu librement mais la dose réelle peut varier énormément par rapport à l'étiquette.",
      ] },
      { callout: "L'ANSES déconseille la mélatonine aux femmes enceintes ou qui allaitent, aux enfants et ados, aux personnes avec une maladie inflammatoire ou auto-immune, et avant une activité qui demande de la vigilance (comme conduire). Demande l'avis d'un médecin en cas d'épilepsie, d'asthme, de troubles de l'humeur, ou si tu prends un anticoagulant ou d'autres traitements.", tone: "warn" },
      { refs: ["Herxheimer A. & Petrie K.J., Cochrane 2002 (CD001520)", "Burgess H.J. et al., J Clin Endocrinol Metab 2010 (0,5 vs 3 mg)", "ANSES, avis du 11 avril 2018 (2016-SA-0209)", "EFSA Journal 2010;8(2):1467", "Erland L.A. & Saxena P.K., J Clin Sleep Med 2017"] },
    ],
  },
  {
    id: "cafeine",
    title: "Caféine et théine",
    kicker: "Stratégique, pas automatique",
    icon: "cup",
    tone: "coffee",
    minutes: 2,
    blocks: [
      { p: "Théine et caféine, c'est exactement la même molécule. Le thé en contient juste moins par tasse. Bien utilisée, elle t'aide à tenir pendant les journées difficiles. Mal placée, elle vole ton sommeil de la nuit suivante, et c'est ce sommeil qui recale ton horloge." },
      { h: "Combien de temps elle agit" },
      { p: "Il faut environ 5 h pour éliminer la moitié d'une dose (entre 2 et 10 h selon les personnes, plus sous pilule contraceptive ou pendant la grossesse). Une grosse dose prise 6 h avant le coucher réduit encore le sommeil de plus d'une heure. D'où la limite de 8 h avant le coucher dans le plan (10 h si tu y es sensible)." },
      { table: { head: ["Boisson", "Caféine (environ)"], rows: [
        ["Espresso", "60 à 100 mg"],
        ["Café filtre (grande tasse)", "90 à 120 mg"],
        ["Thé noir (tasse)", "40 à 50 mg"],
        ["Thé vert (tasse)", "25 à 35 mg"],
        ["Matcha (une portion)", "40 à 70 mg"],
        ["Cola (33 cl)", "35 mg"],
        ["Boisson énergisante (25 cl)", "80 mg"],
      ] } },
      { h: "La stratégie" },
      { list: [
        "Petites doses plutôt qu'un grand gobelet : un espresso ou deux thés noirs quand ton corps est en « pleine nuit » et que tu dois tenir.",
        "Rien après ta limite du jour, même si tu te sens KO : c'est justement la nuit qui va te remettre d'aplomb.",
        "Pas de café avant une phase de sommeil en vol.",
        "Maximum conseillé : 400 mg par jour, 200 mg d'un coup (200 mg par jour pendant la grossesse).",
      ] },
      { callout: "Astuce « café-sieste » : bois un espresso juste avant une sieste de 20 minutes. La caféine agit au moment où tu te réveilles.", tone: "tip" },
      { refs: ["Drake C. et al., J Clin Sleep Med 2013", "Burke T.M. et al., Sci Transl Med 2015", "EFSA Journal 2015;13(5):4102", "EUFIC, teneur en caféine des aliments"] },
    ],
  },
  {
    id: "avion",
    title: "Dormir en avion, pour de vrai",
    kicker: "Réaliste",
    icon: "plane",
    tone: "sleep",
    minutes: 3,
    blocks: [
      { p: "Les conseils du type « dors pendant le vol » oublient que personne ne dort à la porte d'embarquement, ni pendant le roulage et le décollage. Fuseau part de ce qui est vraiment possible." },
      { h: "Avant l'embarquement" },
      { list: [
        "N'essaie pas de dormir à la porte : bruit, annonces, lumière. Vise un « repos calme » : assis, yeux fermés, respiration lente, écran au minimum.",
        "Si tu dois dormir tôt dans le vol : mange avant d'embarquer, tu sauteras le premier service.",
        "Pas de café à partir de là si une phase de sommeil arrive.",
      ] },
      { h: "Décollage et service" },
      { list: [
        "Le premier repas arrive généralement 45 à 90 minutes après le décollage et le service dure une bonne heure. C'est long quand on veut dormir.",
        "Installe tout avant : masque, bouchons ou casque, chaussettes chaudes, couverture. Ceinture attachée par-dessus la couverture pour qu'on ne te réveille pas.",
        "Dis à l'équipage que tu ne veux pas être réveillé(e) pour les repas.",
      ] },
      { h: "Ce qu'on peut attendre" },
      { list: [
        "En classe éco, le sommeil est fragmenté : 50 à 60 % du temps passé les yeux fermés, c'est déjà bien.",
        "Même éveillé(e), rester dans le noir, yeux fermés, compte : ça repose et ça évite la lumière au mauvais moment.",
        "Siège hublot si tu veux dormir (pas de voisin qui te réveille, appui pour la tête). Couloir si tu préfères bouger souvent.",
      ] },
      { h: "Alcool et somnifères" },
      { p: "L'alcool fragmente le sommeil. En altitude simulée, une étude de 2024 montre que dormir après deux verres fait chuter l'oxygénation du sang à environ 85 % en médiane, avec un cœur qui s'accélère. Évite-le à bord." },
      { callout: "Somnifères : seulement sur avis médical, jamais pour la première fois en vol, et jamais si tu ne peux pas dormir au moins 7 h ou si tu dois conduire à l'arrivée. Ils immobilisent, ce qui augmente le risque de phlébite.", tone: "warn" },
      { refs: ["Trammer R.A. et al., Thorax 2024 (alcool et altitude)", "Rosekind M.R. et al., NASA TM 1994"] },
    ],
  },
  {
    id: "transports",
    title: "Aéroport, VTC et arrivée",
    kicker: "Porte à porte",
    icon: "car",
    tone: "shade",
    minutes: 2,
    blocks: [
      { p: "Ton voyage ne commence pas au décollage. Le trajet vers l'aéroport, l'attente, la sortie et le taxi à l'arrivée pèsent lourd : ce sont souvent des moments où tu reçois de la lumière au mauvais moment, sans t'en rendre compte." },
      { list: [
        "Renseigne tes temps de trajet dans le voyage : Fuseau place les consignes de lumière pile dans le VTC ou le train.",
        "Arrivée le matin après un vol de nuit vers l'est : c'est LE moment où il faut souvent porter des lunettes de soleil dans le taxi, même si c'est tentant de profiter de la vue.",
        "Arrivée le matin : la chambre n'est souvent prête qu'à 15 h. Prévois une douche (salon d'arrivée, salle de sport de l'hôtel) et une activité dehors si le plan dit « lumière ».",
        "Tu conduis à l'arrivée ? Après une nuit courte, la somnolence au volant est un vrai risque. Au moindre signe, arrête-toi pour 20 minutes de sieste ou prends un taxi.",
      ] },
      { callout: "Mets ta montre et ton téléphone à l'heure de destination dès l'embarquement. Fuseau affiche d'ailleurs toutes les heures du vol à l'heure d'arrivée.", tone: "tip" },
    ],
  },
  {
    id: "siestes",
    title: "Les siestes qui aident (et les autres)",
    kicker: "Court et tôt",
    icon: "moon",
    tone: "sleep",
    minutes: 1,
    blocks: [
      { list: [
        "20 à 25 minutes, alarme obligatoire. Au-delà de 30 minutes, tu plonges en sommeil profond et tu te réveilles groggy.",
        "Avant 16 h à l'heure locale, et au moins 7 h avant ton coucher, sinon ta nuit en pâtit.",
        "Dans l'étude de la NASA sur des pilotes long-courrier, une sieste d'environ 26 minutes a nettement amélioré la vigilance en fin de vol.",
      ] },
      { callout: "Le jour de l'arrivée, si tu n'as presque pas dormi en vol, une sieste courte vaut mieux que « tenir » en zombie, puis craquer à 18 h pour 3 heures.", tone: "tip" },
      { refs: ["Rosekind M.R. et al., J Sleep Res 1995", "CDC Yellow Book 2026, Jet Lag Disorder"] },
    ],
  },
  {
    id: "corps",
    title: "Repas, sport, eau",
    kicker: "Les coups de pouce",
    icon: "leaf",
    tone: "accent",
    minutes: 2,
    blocks: [
      { h: "Repas" },
      { p: "Manger à l'heure locale dès l'arrivée aide les horloges de ton foie et de ton intestin à suivre. Les régimes « anti-jet lag » avec jeûne (type Argonne) ont des preuves faibles : pas besoin de te priver, mange léger le soir et évite les gros repas en pleine nuit biologique." },
      { h: "Sport" },
      { p: "L'exercice décale aussi l'horloge, moins que la lumière. Une étude de 2019 montre qu'un effort le matin (vers 7 h) ou en début d'après-midi (13 h à 16 h) avance l'horloge, et qu'en soirée (19 h à 22 h) il la retarde. Le mieux : bouger dehors pendant une fenêtre « cherche la lumière », tu cumules les deux." },
      { h: "Eau et circulation" },
      { list: [
        "L'air de cabine est très sec : un verre d'eau par heure éveillé(e).",
        "Au-delà de 4 h de vol, le risque de phlébite double à peu près. Lève-toi, marche, fais des rotations de chevilles.",
        "Les chaussettes de contention réduisent fortement les phlébites silencieuses sur les vols de plus de 4 h (revue Cochrane 2021).",
      ] },
      { refs: ["Youngstedt S.D. et al., J Physiol 2019", "Reynolds N.C. & Montgomery R., Mil Med 2002", "OMS, projet WRIGHT 2007", "Clarke M.J. et al., Cochrane 2021 (CD004002)"] },
    ],
  },
  {
    id: "court",
    title: "Voyage court : ne bouge pas ton horloge",
    kicker: "3 nuits ou moins",
    icon: "home",
    tone: "accent",
    minutes: 1,
    blocks: [
      { p: "Pour un aller-retour de 1 à 3 nuits, recaler ton horloge ne vaut pas le coup : le temps qu'elle s'adapte, tu repars. Mieux vaut rester à l'heure de chez toi autant que possible." },
      { list: [
        "Place tes rendez-vous importants sur tes heures de forme habituelles.",
        "Dors aux heures de chez toi si ton programme le permet, dans une chambre bien noire.",
        "Utilise la caféine de façon ciblée pour les moments clés.",
      ] },
      { callout: "Fuseau le détecte si tu renseignes ta date de retour, et te propose ce mode automatiquement.", tone: "tip" },
    ],
  },
  {
    id: "securite",
    title: "Quand demander conseil",
    kicker: "Sécurité",
    icon: "shield",
    tone: "shade",
    minutes: 1,
    blocks: [
      { p: "Fuseau donne des conseils généraux issus de la recherche. Il ne remplace pas un avis médical." },
      { list: [
        "Grossesse, allaitement, enfant qui voyage.",
        "Traitement en cours (anticoagulants, antiépileptiques, antidépresseurs, somnifères, contraception orale pour la caféine).",
        "Trouble du sommeil connu (apnée, insomnie chronique), maladie cardiaque ou antécédent de phlébite.",
        "Traitement à heures fixes (insuline, contraception, etc.) : l'adaptation des horaires se discute avec ton médecin ou ton pharmacien.",
      ] },
    ],
  },
];

export const SOURCES: string[] = [
  "Waterhouse J., Reilly T., Atkinson G., Edwards B. Jet lag: trends and coping strategies. Lancet 2007;369:1117-1129.",
  "Eastman C.I., Burgess H.J. How to travel the world without jet lag. Sleep Med Clin 2009;4:241-255.",
  "Khalsa S.B. et al. A phase response curve to single bright light pulses in human subjects. J Physiol 2003;549:945-952.",
  "St Hilaire M.A. et al. Human phase response curve to a 1 h pulse of bright white light. J Physiol 2012;590:3035-3045.",
  "Roach G.D., Sargent C. Interventions to minimize jet lag after westward and eastward flight. Front Physiol 2019;10:927.",
  "Herxheimer A., Petrie K.J. Melatonin for the prevention and treatment of jet lag. Cochrane Database Syst Rev 2002;CD001520.",
  "Burgess H.J. et al. Human phase response curves to three days of daily melatonin: 0.5 mg versus 3.0 mg. J Clin Endocrinol Metab 2010;95:3325-3331.",
  "Eastman C.I. et al. Advancing circadian rhythms before eastward flight. Sleep 2005;28:33-44.",
  "Burgess H.J. et al. Preflight adjustment to eastward travel. J Biol Rhythms 2003;18:318-328.",
  "ANSES. Avis relatif aux risques liés à la consommation de compléments alimentaires contenant de la mélatonine, 2018 (2016-SA-0209).",
  "EFSA. Scientific opinion on melatonin health claims. EFSA Journal 2010;8(2):1467.",
  "Drake C. et al. Caffeine effects on sleep taken 0, 3, or 6 hours before going to bed. J Clin Sleep Med 2013;9:1195-1200.",
  "Burke T.M. et al. Effects of caffeine on the human circadian clock in vivo and in vitro. Sci Transl Med 2015;7:305ra146.",
  "EFSA. Scientific opinion on the safety of caffeine. EFSA Journal 2015;13(5):4102.",
  "Brown T.M. et al. Recommendations for daytime, evening, and nighttime indoor light exposure. PLoS Biol 2022;20:e3001571.",
  "Youngstedt S.D., Elliott J.A., Kripke D.F. Human circadian phase-response curves for exercise. J Physiol 2019;597:2253-2268.",
  "Trammer R.A. et al. Effects of moderate alcohol consumption and hypobaric hypoxia on sleep. Thorax 2024.",
  "Clarke M.J. et al. Compression stockings for preventing deep vein thrombosis in airline passengers. Cochrane 2021;CD004002.",
  "WHO Research Into Global Hazards of Travel (WRIGHT) project, 2007.",
  "Rosekind M.R. et al. Crew factors in flight operations IX: effects of planned cockpit rest. NASA TM-108839, 1994.",
  "CDC Yellow Book 2026. Jet lag disorder.",
];
