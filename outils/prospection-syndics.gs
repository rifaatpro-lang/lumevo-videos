/**
 * Lumevo – Prospection syndics : envoi des mails avec la plaquette en pièce jointe.
 * L'agent écrit les mails dans l'onglet « Envois » de la feuille ; ce programme les
 * transforme en brouillons ou en mails envoyés depuis contact@lumevo.fr.
 */
var NOM_FEUILLE = 'Prospection syndics Lumevo';
var DOSSIER_AGENTS = '1lKM7yO-Dv1-d0U0gR7t14kM_dnLRnQUb';
var URL_PLAQUETTE = 'https://cdn.shopify.com/s/files/1/0819/0843/3243/files/Plaquette-Lumevo-Electricien-coproprietes.pdf';
var NOM_PLAQUETTE = 'Plaquette-Lumevo-Electricien-coproprietes.pdf';
var EXPEDITEUR = 'contact@lumevo.fr';
var NOM_EXPEDITEUR = 'Rifaat – Lumevo Électricien';
var LIBELLE = 'Prospection syndics';
var MAX_PAR_JOUR = 5;
var MAX_PAR_SEMAINE = 15;
var SIGNATURE_HTML =
  '<br><br><b>Lumevo Électricien</b><br>SIRET : 891 310 963 00014<br><b>Rifaat IBRAHIM</b><br>Chef d\'entreprise<br><br>' +
  'Site web : <a href="https://www.lumevo.fr">www.lumevo.fr</a> • Mob. +33 (0) 7 50 01 90 25<br>' +
  '<a href="mailto:contact@lumevo.fr">contact@lumevo.fr</a>';
var SIGNATURE_TEXTE =
  '\n\nLumevo Électricien\nSIRET : 891 310 963 00014\nRifaat IBRAHIM\nChef d\'entreprise\n\n' +
  'Site web : www.lumevo.fr • Mob. +33 (0) 7 50 01 90 25\ncontact@lumevo.fr';

var ENTETES_ENVOIS = ['ID', 'Cabinet', 'Destinataire', 'Objet', 'Texte', 'Type (PREMIER ou RELANCE)',
  'Mode (BROUILLON ou ENVOYER)', 'Statut', 'Date de traitement', 'Détail'];

/** À lancer une seule fois : crée la feuille, range la plaquette, programme le passage horaire. */
function installer() {
  var props = PropertiesService.getScriptProperties();
  var ss;
  var id = props.getProperty('FEUILLE_ID');
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create(NOM_FEUILLE);
    props.setProperty('FEUILLE_ID', ss.getId());
    try { DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(DOSSIER_AGENTS)); } catch (e) {}
    var ref = ss.getSheets()[0]; ref.setName('Référence');
    ref.getRange(1, 1, 8, 2).setValues([
      ['Envoi automatique', 'non'],
      ['Zone', 'Val-d\'Oise (95), Hauts-de-Seine (92), Paris (75)'],
      ['Engagements', 'Devis sous 48 h, intervention sous 48 h, photos et compte rendu après chaque passage'],
      ['Offre', 'Visite de contrôle offerte avec constat écrit ; devis comparatif sous 48 h'],
      ['Références', 'Lamy, Triarc Immobilier (ne jamais les prospecter)'],
      ['Plaquette', URL_PLAQUETTE],
      ['Plafond', MAX_PAR_JOUR + ' mails par jour, ' + MAX_PAR_SEMAINE + ' par semaine'],
      ['Arrêt automatique', 'non']
    ]);
    var cibles = ss.insertSheet('Cibles');
    cibles.appendRow(['Cabinet', 'Ville', 'Département', 'Site', 'Interlocuteur', 'Adresse utilisée',
      'Source de l\'adresse (URL)', 'Fiche agence', 'Statut', 'Date d\'envoi', 'Date de relance', 'Objet du mail', 'Note']);
    var envois = ss.insertSheet('Envois');
    envois.appendRow(ENTETES_ENVOIS);
    var journal = ss.insertSheet('Journal');
    journal.appendRow(['Date', 'Qui', 'Action', 'Détail']);
    [ref, cibles, envois, journal].forEach(function (s) { s.setFrozenRows(s.getName() === 'Référence' ? 0 : 1); });
  }
  if (!props.getProperty('PLAQUETTE_ID')) {
    var blob = UrlFetchApp.fetch(URL_PLAQUETTE).getBlob().setName(NOM_PLAQUETTE);
    var f = DriveApp.createFile(blob);
    try { f.moveTo(DriveApp.getFolderById(DOSSIER_AGENTS)); } catch (e) {}
    props.setProperty('PLAQUETTE_ID', f.getId());
  }
  if (!GmailApp.getUserLabelByName(LIBELLE)) GmailApp.createLabel(LIBELLE);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'traiterEnvois') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('traiterEnvois').timeBased().everyHours(1).create();
  journal_(ss, 'Installation', 'Feuille prête, plaquette rangée, passage toutes les heures. Alias disponibles : ' + GmailApp.getAliases().join(', '));
  return ss.getUrl();
}

/** Passe toutes les heures : traite les lignes « À traiter » de l'onglet Envois. */
function traiterEnvois() {
  var verrou = LockService.getScriptLock();
  if (!verrou.tryLock(20000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var ss = SpreadsheetApp.openById(props.getProperty('FEUILLE_ID'));
    var envois = ss.getSheetByName('Envois');
    var ref = ss.getSheetByName('Référence');
    var auto = String(ref.getRange('B1').getValue()).trim().toLowerCase() === 'oui';
    var arret = String(ref.getRange('B8').getValue()).trim().toLowerCase() === 'oui';
    var lignes = envois.getDataRange().getValues();
    var maintenant = new Date();
    var envoyesJour = 0, envoyesSemaine = 0;
    var dejaContactes = {};
    for (var i = 1; i < lignes.length; i++) {
      var st = String(lignes[i][7]);
      var d = lignes[i][8];
      if (st === 'Envoyé' && String(lignes[i][5]).toUpperCase() !== 'RELANCE') {
        dejaContactes[String(lignes[i][2]).trim().toLowerCase()] = true;
        if (d instanceof Date) {
          if (maintenant - d < 24 * 3600 * 1000) envoyesJour++;
          if (maintenant - d < 7 * 24 * 3600 * 1000) envoyesSemaine++;
        }
      }
    }
    var plaquette = DriveApp.getFileById(props.getProperty('PLAQUETTE_ID')).getBlob().setName(NOM_PLAQUETTE);
    var libelle = GmailApp.getUserLabelByName(LIBELLE) || GmailApp.createLabel(LIBELLE);
    var aliasOk = GmailApp.getAliases().indexOf(EXPEDITEUR) !== -1;

    for (var r = 1; r < lignes.length; r++) {
      if (String(lignes[r][7]).trim() !== 'À traiter') continue;
      var dest = String(lignes[r][2]).trim();
      var objet = String(lignes[r][3]).trim();
      var texte = String(lignes[r][4]).trim();
      var type = String(lignes[r][5]).trim().toUpperCase() === 'RELANCE' ? 'RELANCE' : 'PREMIER';
      var mode = String(lignes[r][6]).trim().toUpperCase();
      var ecrire = function (statut, detail) {
        envois.getRange(r + 1, 8, 1, 3).setValues([[statut, new Date(), detail]]);
      };
      try {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) { ecrire('Erreur', 'Adresse invalide'); continue; }
        if (!objet || texte.length < 80) { ecrire('Erreur', 'Objet ou texte manquant'); continue; }
        if (/lamy|triarc/i.test(dest)) { ecrire('Erreur', 'Client existant : ne pas prospecter'); continue; }
        if (!aliasOk) { ecrire('Erreur', 'Adresse ' + EXPEDITEUR + ' indisponible dans Gmail'); continue; }
        var options = {
          from: EXPEDITEUR, name: NOM_EXPEDITEUR,
          htmlBody: texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>') + SIGNATURE_HTML
        };
        var envoyer = (mode === 'ENVOYER') && auto && !arret;
        if (type === 'PREMIER') {
          if (dejaContactes[dest.toLowerCase()]) { ecrire('Erreur', 'Déjà contacté'); continue; }
          options.attachments = [plaquette];
          if (envoyer) {
            if (envoyesJour >= MAX_PAR_JOUR || envoyesSemaine >= MAX_PAR_SEMAINE) continue; // attend le prochain passage
            GmailApp.sendEmail(dest, objet, texte + SIGNATURE_TEXTE, options);
            envoyesJour++; envoyesSemaine++; dejaContactes[dest.toLowerCase()] = true;
            Utilities.sleep(3000);
            var fils = GmailApp.search('in:sent to:' + dest + ' newer_than:1d', 0, 1);
            if (fils.length) fils[0].addLabel(libelle);
            ecrire('Envoyé', 'Avec plaquette');
          } else {
            var b = GmailApp.createDraft(dest, objet, texte + SIGNATURE_TEXTE, options);
            b.getMessage().getThread().addLabel(libelle);
            ecrire('Brouillon créé', 'Avec plaquette');
          }
        } else {
          var anciens = GmailApp.search('in:sent to:' + dest + ' label:' + LIBELLE.replace(/ /g, '-'), 0, 1);
          if (!anciens.length) { ecrire('Erreur', 'Premier mail introuvable pour la relance'); continue; }
          if (envoyer) {
            anciens[0].reply(texte + SIGNATURE_TEXTE, options);
            ecrire('Envoyé', 'Relance');
          } else {
            anciens[0].createDraftReply(texte + SIGNATURE_TEXTE, options);
            ecrire('Brouillon créé', 'Relance');
          }
        }
      } catch (e) {
        ecrire('Erreur', String(e).slice(0, 300));
      }
    }
  } finally {
    verrou.releaseLock();
  }
}

/** Essai : crée un brouillon de démonstration adressé à l'adresse Lumevo elle-même. */
function essai() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('FEUILLE_ID'));
  ss.getSheetByName('Envois').appendRow(['ESSAI', 'Essai interne', EXPEDITEUR, 'Essai de la plaquette en pièce jointe',
    'Bonjour,\n\nCeci est un essai interne pour vérifier que la plaquette part bien en pièce jointe et que la mise en forme est correcte.\n\nRien à faire, ce brouillon peut être supprimé.',
    'PREMIER', 'BROUILLON', 'À traiter', '', '']);
  traiterEnvois();
}

function journal_(ss, action, detail) {
  ss.getSheetByName('Journal').appendRow([new Date(), 'Programme', action, detail]);
}
