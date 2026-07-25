/**
 * Application d'une action à une partie, avec ses règles d'autorisation.
 *
 * Partagé par le serveur (une requête HTTP par action) et par le client hors ligne
 * (l'action est appliquée directement dans le navigateur) : les deux modes suivent
 * exactement les mêmes règles.
 */

(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./match'));
  else {
    global.Darts301 = global.Darts301 || {};
    global.Darts301.actions = factory(global.Darts301.match);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (matchLib) {
  'use strict';

  const { HttpError } = matchLib;

  function applyAction(match, player, body) {
    const isHost = match.hostId === player.id;
    const requireHost = () => {
      if (!isHost) throw new HttpError(403, 'Réservé à l’hôte de la partie.');
    };

    switch (body.action) {
      case 'settings':
        requireHost();
        match.updateSettings(body.settings);
        break;
      case 'start':
        requireHost();
        match.start();
        break;
      case 'shuffle':
        requireHost();
        match.shufflePlayers();
        break;
      case 'add-player':
        requireHost();
        match.addLocalPlayer(body.name);
        break;
      case 'kick': {
        requireHost();
        if (body.playerId === match.hostId) throw new HttpError(400, 'L’hôte ne peut pas se retirer.');
        match.removePlayer(body.playerId);
        break;
      }
      case 'rename': {
        const target = body.playerId && isHost ? match.player(body.playerId) : player;
        if (!target) throw new HttpError(404, 'Joueur introuvable.');
        target.name = String(body.name || '').trim().slice(0, 16) || target.name;
        break;
      }
      case 'leave':
        match.removePlayer(player.id);
        break;
      case 'throw':
        match.throwDart(body.playerId && isHost ? body.playerId : player.id, body.segment);
        break;
      case 'undo-dart':
        match.undoDart(player.id);
        break;
      case 'undo-turn':
        match.undoTurn(player.id);
        break;
      case 'next-leg':
        match.nextLeg();
        break;
      case 'rematch':
        requireHost();
        match.rematch();
        break;
      case 'lobby':
        requireHost();
        match.backToLobby();
        break;
      default:
        throw new HttpError(400, `Action inconnue : ${body.action}`);
    }
  }

  return { applyAction };
}));
