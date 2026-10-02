// Diffuseurs légaux, regardés avec un abonnement télé dans le navigateur (mode surcouche).
// On n'ouvre que la page d'accueil du diffuseur : l'utilisateur s'y connecte avec son fournisseur.
export const PROVIDERS = [
  { id: 'rds', name: 'RDS', lang: 'fr', url: 'https://www.rds.ca/' },
  { id: 'tva', name: 'TVA Sports', lang: 'fr', url: 'https://www.tvasports.ca/' },
  { id: 'sportsnet', name: 'Sportsnet+', lang: 'en', url: 'https://watch.sportsnet.ca/' },
  { id: 'tsn', name: 'TSN', lang: 'en', url: 'https://www.tsn.ca/' },
  { id: 'prime', name: 'Prime Video', lang: 'en', url: 'https://www.primevideo.com/' },
  { id: 'app-fr', name: 'Appli de mon fournisseur (français)', lang: 'fr', url: '' },
  { id: 'app-en', name: 'Appli de mon fournisseur (anglais)', lang: 'en', url: '' },
];

export function providerOf(id) {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}
