# Ruptures du jour — La Coursive des Alpes

**Site : https://viktor-guignard.github.io/la-coursive-carte-mobile/**

Page pensée pour le téléphone : masquer en quelques secondes un plat épuisé, sans ouvrir l'éditeur complet.

- **🔍 Rechercher** : taper quelques lettres (« burr », « foie »…). Les accents et les majuscules n'ont pas d'importance.
- **Filtres** : Tout, Carte, À partager, Vins, Boissons, Cocktails, et **Masqués** pour voir d'un coup ce qui est retiré.
- **👁 au bout de chaque ligne** : masquer / réafficher. Rien ne part tant qu'on n'a pas touché **Enregistrer** (ou **Annuler**).
- **Tout réafficher** (dans le filtre Masqués) : pour remettre la carte complète en début de service.
- **Sur l'écran d'accueil** : Safari → Partager → « Sur l'écran d'accueil ». La page s'ouvre alors comme une app.

## Ce que fait « Enregistrer »

Cette page n'a aucune donnée à elle. Elle lit et écrit dans le dépôt de l'éditeur, [`la-coursive-carte`](https://github.com/Viktor-Guignard/la-coursive-carte) :

1. **`published.json`** : la carte des clients (QR code) ne montre plus le plat, en quelques minutes (cache de GitHub).
2. **Une nouvelle version** dans `versions/<carte>/` : l'éditeur affiche le plat « 👁 Masqué du site » à sa prochaine ouverture. Une publication depuis l'éditeur ne le fera donc pas réapparaître.

Seul le drapeau `hidden` des plats touchés change. Les fichiers sont relus juste avant l'écriture, et le reste est réécrit tel quel.

## Autoriser un téléphone (une seule fois)

Le jeton est le même que celui de l'éditeur. Les deux pages sont sur `viktor-guignard.github.io`, donc un téléphone déjà activé pour l'éditeur l'est aussi ici. Sinon :

- ouvrir sur le téléphone le **lien magique** copié depuis l'éditeur (⚙️ → ✨ Copier le lien magique) ;
- ou coller le jeton dans le panneau de réglages (pastille en haut à droite).

## Technique

- Site 100 % statique (HTML/CSS/JS, aucun build), hébergé sur GitHub Pages.
- `gh.js` est une copie de celui de l'éditeur : il cible volontairement le dépôt `la-coursive-carte`.
- Le jeton *fine-grained* n'a besoin que de l'accès en écriture au contenu de `la-coursive-carte`.

### Développement local

```
python3 -m http.server 4195
```
