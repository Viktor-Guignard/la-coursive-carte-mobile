# Ma carte — La Coursive des Alpes

**Web app : https://viktor-guignard.github.io/la-coursive-carte-mobile/**

L'app du restaurant pour tenir la carte à jour depuis le téléphone, sans ouvrir l'éditeur complet. Elle s'installe sur l'écran d'accueil et s'ouvre en plein écran.

- **🔍 Rechercher** : quelques lettres suffisent (« burr », « foie »…). Les accents et les majuscules n'ont pas d'importance.
- **Filtres** : Tout, Carte, À partager, Vins, Boissons, Cocktails, et **Masqués** pour voir d'un coup ce qui est retiré.
- **👁 au bout de chaque ligne** : masquer ou réafficher un produit épuisé.
- **Toucher un produit** ouvre sa fiche. On y change le nom, la traduction, le prix, les pictos (V végétarien, ★ spécialité, sur la Carte) et la visibilité. On peut aussi le supprimer (deux appuis).
- **+ Ajouter un produit** en fin de rubrique : le nouveau produit se place à cet endroit de la carte.
- Rien ne part tant qu'on n'a pas touché **Publier** (ou **Annuler**).
- **Tout réafficher** (dans le filtre Masqués) remet la carte complète en début de service.

La mise en page, les rubriques, le PDF et l'apparence restent dans l'éditeur complet.

## Installer l'app

- **iPhone** : Safari → Partager → « Sur l'écran d'accueil ». L'app installée ne partage pas les réglages de Safari : au premier lancement, touchez la pastille « À activer » et collez le lien magique.
- **Android** : Chrome → ⋮ → « Installer l'application ». L'app propose aussi son propre bouton d'installation.

## Ce que fait « Publier »

Cette app n'a aucune donnée à elle. Elle lit et écrit dans le dépôt de l'éditeur, [`la-coursive-carte`](https://github.com/Viktor-Guignard/la-coursive-carte) :

1. **`published.json`** : la carte des clients (QR code) change en quelques minutes (cache de GitHub).
2. **Une nouvelle version** dans `versions/<carte>/` : l'éditeur affiche les changements à sa prochaine ouverture. Une publication depuis l'éditeur ne les défait donc pas.

Les changements sont gardés comme une liste d'opérations (modifier, ajouter, supprimer), puis rejoués sur les deux fichiers relus juste avant l'écriture. Seuls les produits touchés changent. Chaque publication crée un commit qui décrit ce qui a changé, et toutes les anciennes versions restent dans 🕑 Versions de l'éditeur.

## Autoriser un téléphone (une seule fois)

Le jeton est celui de l'éditeur. Dans le navigateur, les deux sites sont sur `viktor-guignard.github.io`, donc un téléphone déjà activé pour l'éditeur l'est aussi ici. Sinon :

- ouvrir sur le téléphone le **lien magique** copié depuis l'éditeur (⚙️ → ✨ Copier le lien magique) ;
- ou le coller dans le panneau d'accès (pastille en haut à droite). Ce panneau accepte le lien entier ou le jeton seul.

## Technique

- Site 100 % statique (HTML/CSS/JS, aucun build), hébergé sur GitHub Pages.
- Web app : `manifest.webmanifest` et `sw.js`. Le service worker va au réseau d'abord pour les fichiers de l'app (les mises à jour arrivent tout de suite) et ne touche jamais aux données.
- `gh.js` est une copie de celui de l'éditeur : il cible volontairement le dépôt `la-coursive-carte`.
- Le jeton *fine-grained* n'a besoin que de l'accès en écriture au contenu de `la-coursive-carte`.

### Développement local

```
python3 -m http.server 4195
```
