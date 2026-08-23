# Envoi des e-mails de récupération

Parici peut envoyer les liens de récupération par Google Apps Script, Brevo ou SMTP. Pour Render gratuit sans domaine personnel, Google Apps Script est le transport recommandé : l'appel sortant utilise HTTPS et le message est envoyé par le compte Gmail Parici.

## Configuration Google Apps Script

1. Ouvrir <https://script.google.com> avec `camino.sunmedia@gmail.com` et créer un projet.
2. Remplacer le contenu de `Code.gs` par celui de `scripts/google_apps_script_mailer.gs`.
3. Dans **Paramètres du projet > Propriétés du script**, ajouter `CAMINO_MAIL_SECRET` avec une valeur aléatoire longue (au moins 32 caractères).
4. Choisir **Déployer > Nouveau déploiement > Application web**.
5. Sélectionner **Exécuter en tant que : Moi** et **Qui a accès : Tout le monde**.
6. Autoriser l'accès à l'envoi d'e-mails, puis copier l'URL déployée terminant par `/exec`.
7. Ajouter sur Render les variables suivantes avec exactement le même secret :

   ```text
   MAIL_PROVIDER=google_apps_script
   GOOGLE_APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
   GOOGLE_APPS_SCRIPT_SECRET=valeur_de_CAMINO_MAIL_SECRET
   ```

Après modification du script, créer une nouvelle version du déploiement pour que l'URL `/exec` exécute le code actualisé.

Le secret ne doit être ni commité dans Git ni transmis dans les journaux. Le compte Gmail personnel dispose d'un quota Google Apps Script de 100 destinataires par jour.
