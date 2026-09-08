// Pre-translated spoken safety instructions for voice alerts (GEG bonus —
// multilingual voice alerts). Keyed by scenario so the phrasing is fixed and
// reviewed, not machine-translated at runtime. Any scenario / language without
// an entry falls back to the alert's English `immediate_action`.

export const SUPPORTED_LANGS = [
  { code: 'en', label: 'English', bcp47: 'en-US' },
  { code: 'es', label: 'Español', bcp47: 'es-ES' },
  { code: 'hi', label: 'हिन्दी', bcp47: 'hi-IN' },
  { code: 'fr', label: 'Français', bcp47: 'fr-FR' },
  { code: 'de', label: 'Deutsch', bcp47: 'de-DE' },
]

const SPOKEN = {
  box_overhang: {
    en: 'Carton is overhanging. Push it back so the base is fully supported.',
    es: 'La caja sobresale. Empújela hacia atrás para apoyar toda la base.',
    hi: 'कार्टन किनारे से बाहर है। इसे पीछे धकेलें ताकि आधार पूरी तरह सहारे पर हो।',
    fr: 'Le carton dépasse. Repoussez-le pour que la base soit entièrement soutenue.',
    de: 'Karton steht über. Schieben Sie ihn zurück, bis die Grundfläche voll aufliegt.',
  },
  pallet_overhang: {
    en: 'Load overhangs the pallet. Align the cartons inside the pallet edges.',
    es: 'La carga sobresale del palé. Alinee las cajas dentro de los bordes.',
    hi: 'भार पैलेट से बाहर है। कार्टन को पैलेट के किनारों के अंदर रखें।',
    fr: 'La charge dépasse la palette. Alignez les cartons dans les bords.',
    de: 'Ladung steht über die Palette. Kartons innerhalb der Palettenkanten ausrichten.',
  },
  unsupported_bending_placement: {
    en: 'Carton base is unsupported and bending. Reposition it onto solid support.',
    es: 'La base de la caja no tiene apoyo y se dobla. Colóquela sobre un apoyo firme.',
    hi: 'कार्टन का आधार बिना सहारे मुड़ रहा है। इसे ठोस सहारे पर रखें।',
    fr: 'La base du carton fléchit sans appui. Replacez-le sur un support solide.',
    de: 'Kartonboden biegt sich ohne Auflage. Auf feste Unterlage umsetzen.',
  },
  heavy_on_light_stacking: {
    en: 'Heavy carton on a lighter one. Move the heavy carton to the base tier.',
    es: 'Caja pesada sobre una más ligera. Ponga la pesada en la base.',
    hi: 'भारी कार्टन हल्के पर रखा है। भारी कार्टन को सबसे नीचे रखें।',
    fr: 'Carton lourd sur un plus léger. Placez le lourd à la base.',
    de: 'Schwerer Karton auf leichterem. Schweren Karton nach unten setzen.',
  },
  wrong_product_orientation: {
    en: 'Package is on its side. Rotate it upright, following the arrows.',
    es: 'El paquete está de lado. Gírelo hacia arriba siguiendo las flechas.',
    hi: 'पैकेज गलत दिशा में है। तीरों के अनुसार इसे सीधा करें।',
    fr: 'Colis couché. Remettez-le debout en suivant les flèches.',
    de: 'Paket liegt falsch. Nach Pfeilen aufrecht drehen.',
  },
  dragging_precursor: {
    en: 'Do not drag the carton. Use a pallet jack or a team lift.',
    es: 'No arrastre la caja. Use una transpaleta o levante entre dos.',
    hi: 'कार्टन को न घसीटें। पैलेट जैक या दो लोगों से उठाएं।',
    fr: 'Ne traînez pas le carton. Utilisez un transpalette ou portez à deux.',
    de: 'Karton nicht schleifen. Hubwagen oder Zweierhebung verwenden.',
  },
  dropping_or_throwing_precursor: {
    en: 'Do not drop or throw cartons. Lower them with both hands under control.',
    es: 'No deje caer ni lance cajas. Bájelas con las dos manos, controladamente.',
    hi: 'कार्टन गिराएं या फेंकें नहीं। दोनों हाथों से संभालकर नीचे रखें।',
    fr: 'Ne lâchez pas et ne lancez pas les cartons. Descendez-les à deux mains.',
    de: 'Kartons nicht fallen lassen oder werfen. Kontrolliert mit beiden Händen absetzen.',
  },
  rolling_precursor: {
    en: 'Do not roll cargo along the floor. Keep it flat on a pallet.',
    es: 'No ruede la carga por el suelo. Manténgala plana sobre un palé.',
    hi: 'सामान को फर्श पर न लुढ़काएं। इसे पैलेट पर सीधा रखें।',
    fr: 'Ne roulez pas la charge au sol. Gardez-la à plat sur une palette.',
    de: 'Ware nicht über den Boden rollen. Flach auf einer Palette lassen.',
  },
  straps_as_handles: {
    en: 'Do not lift by the strapping. Grip the carton body.',
    es: 'No levante por el fleje. Sujete el cuerpo de la caja.',
    hi: 'पट्टियों से न उठाएं। कार्टन के मुख्य हिस्से को पकड़ें।',
    fr: 'Ne soulevez pas par le feuillard. Saisissez le corps du carton.',
    de: 'Nicht am Umreifungsband heben. Am Kartonkörper greifen.',
  },
  solo_heavy_handling: {
    en: 'Heavy item. Stop lifting alone. Request a second worker or a pallet jack.',
    es: 'Objeto pesado. No levante solo. Pida otra persona o una transpaleta.',
    hi: 'भारी वस्तु। अकेले न उठाएं। दूसरा व्यक्ति या पैलेट जैक लें।',
    fr: 'Objet lourd. Ne portez pas seul. Demandez un collègue ou un transpalette.',
    de: 'Schweres Teil. Nicht allein heben. Zweite Person oder Hubwagen anfordern.',
  },
  stepping_on_carton: {
    en: 'Step off the carton now. Use the access stairs, not cargo.',
    es: 'Bájese de la caja ahora. Use la escalera de acceso, no la carga.',
    hi: 'तुरंत कार्टन से नीचे उतरें। सामान नहीं, सीढ़ी का उपयोग करें।',
    fr: 'Descendez du carton immédiatement. Utilisez l’escalier, pas la charge.',
    de: 'Sofort vom Karton absteigen. Zugangstreppe benutzen, nicht die Ladung.',
  },
  stepping_on_carton_precursor: {
    en: 'Do not step on cartons. Use the access stairs or a safety ramp.',
    es: 'No pise las cajas. Use la escalera de acceso o una rampa.',
    hi: 'कार्टन पर पैर न रखें। सीढ़ी या सुरक्षा रैंप का उपयोग करें।',
    fr: 'Ne montez pas sur les cartons. Utilisez l’escalier ou une rampe.',
    de: 'Nicht auf Kartons treten. Treppe oder Rampe benutzen.',
  },
  wrong_equipment_usage: {
    en: 'Wrong equipment for this load. Use the trolley the SKU requires.',
    es: 'Equipo incorrecto para esta carga. Use el carro que exige el SKU.',
    hi: 'इस भार के लिए गलत उपकरण। SKU के अनुसार ट्रॉली का उपयोग करें।',
    fr: 'Mauvais équipement pour cette charge. Utilisez le chariot requis.',
    de: 'Falsches Gerät für diese Last. Vorgeschriebenen Wagen verwenden.',
  },
  unplanned_loading_sequence: {
    en: 'Loading out of sequence. Follow the manifest order.',
    es: 'Carga fuera de secuencia. Siga el orden del manifiesto.',
    hi: 'लोडिंग क्रम से बाहर है। मैनिफेस्ट के क्रम का पालन करें।',
    fr: 'Chargement hors séquence. Suivez l’ordre du manifeste.',
    de: 'Beladung außer der Reihe. Reihenfolge laut Manifest einhalten.',
  },
  entity_in_dock_edge_zone: {
    en: 'You are at the dock edge. Move back until the bay door is secured.',
    es: 'Está al borde del muelle. Retroceda hasta asegurar la puerta.',
    hi: 'आप डॉक के किनारे हैं। दरवाज़ा सुरक्षित होने तक पीछे हटें।',
    fr: 'Vous êtes au bord du quai. Reculez jusqu’à ce que la porte soit sécurisée.',
    de: 'Sie sind an der Rampenkante. Zurücktreten, bis das Tor gesichert ist.',
  },
  entity_in_wet_floor_zone: {
    en: 'Wet floor zone. Move the operation to a dry area.',
    es: 'Zona de suelo mojado. Traslade la operación a una zona seca.',
    hi: 'गीले फर्श का क्षेत्र। कार्य को सूखी जगह पर ले जाएं।',
    fr: 'Zone de sol mouillé. Déplacez l’opération vers une zone sèche.',
    de: 'Bereich mit nassem Boden. Arbeit in einen trockenen Bereich verlegen.',
  },
}

const GENERIC = {
  en: 'Safety alert. Check the placement before continuing.',
  es: 'Alerta de seguridad. Revise la colocación antes de continuar.',
  hi: 'सुरक्षा चेतावनी। जारी रखने से पहले प्लेसमेंट जांचें।',
  fr: 'Alerte sécurité. Vérifiez le placement avant de continuer.',
  de: 'Sicherheitshinweis. Platzierung vor dem Weiterarbeiten prüfen.',
}

/** Spoken instruction for an intervention alert in the given language code. */
export function spokenTextFor(alert, langCode) {
  if (!alert) return ''
  const byScenario = SPOKEN[alert.scenario]
  if (byScenario && byScenario[langCode]) return byScenario[langCode]
  if (langCode === 'en') return alert.immediate_action || byScenario?.en || GENERIC.en
  // No reviewed translation for this phrase → speak the English action, and the
  // caller surfaces that it was not translated.
  return alert.immediate_action || GENERIC[langCode] || GENERIC.en
}

/** True when a reviewed translation exists for this alert in this language. */
export function hasTranslation(alert, langCode) {
  return langCode === 'en' || !!SPOKEN[alert?.scenario]?.[langCode]
}
