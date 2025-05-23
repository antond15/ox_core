import { OxPlayer } from 'player/class';
import { CreateUser, GetUserIdFromIdentifier, IsUserBanned, UpdateUserTokens } from './db';
import { GetIdentifiers, GetPlayerLicense } from 'utils';
import { DEBUG, SV_LAN } from '../config';
import type { Dict } from 'types';
import locales from '../../common/locales';

const connectingPlayers: Dict<OxPlayer> = {};

/** Loads existing data for the player, or inserts new data into the database. */
async function loadPlayer(playerId: number) {
  let player: OxPlayer | undefined;

  try {
    if (serverLockdown) return serverLockdown;

    player = new OxPlayer(playerId);
    const license = SV_LAN ? 'fayoum' : GetPlayerLicense(playerId);

    if (!license) return locales('no_license');

    const identifier = license.substring(license.indexOf(':') + 1);
    let userId: number;

    userId = (await GetUserIdFromIdentifier(identifier)) ?? 0;

    if (userId && OxPlayer.getFromUserId(userId)) {
      const kickReason = locales('userid_is_active', userId);

      if (!DEBUG) return kickReason;

      userId = (await GetUserIdFromIdentifier(identifier, 1)) ?? 0;
      if (userId && OxPlayer.getFromUserId(userId)) return kickReason;
    }

    const tokens = getPlayerTokens(playerId);
    await UpdateUserTokens(userId, tokens);

    const ban = await IsUserBanned(userId);

    if (ban) {
      return OxPlayer.formatBanReason(ban);
    }

    player.username = GetPlayerName(player.source as string);
    player.userId = userId ? userId : await CreateUser(player.username, GetIdentifiers(playerId));
    player.identifier = identifier;

    DEV: console.info(`Loaded player data for OxPlayer<${player.userId}>`);

    return player;
  } catch (err) {
    console.error('Error loading player:', err);

    if (player?.userId) {
      try {
        OxPlayer.remove(player.source);
      } catch (cleanupErr) {
        console.error('Error during cleanup:', cleanupErr);
      }
    }

    return err.message;
  }
}

let serverLockdown: string;

setInterval(() => {
  for (const tempId in connectingPlayers) {
    if (!DoesPlayerExist(tempId)) delete connectingPlayers[tempId];
  }
}, 10000);

on('txAdmin:events:serverShuttingDown', () => {
  serverLockdown = locales('server_restarting');
  OxPlayer.saveAll(serverLockdown);
});

on('playerConnecting', async (username: string, _: any, deferrals: any) => {
  const tempId = source;

  deferrals.defer();

  if (serverLockdown) return deferrals.done(serverLockdown);

  const player = await loadPlayer(tempId);

  if (!(player instanceof OxPlayer)) return deferrals.done(player || 'Failed to load player.');

  connectingPlayers[tempId] = player;

  deferrals.done();
});

on('playerJoining', async (tempId: string) => {
  if (serverLockdown) return DropPlayer(source.toString(), serverLockdown);

  const player = connectingPlayers[tempId];

  if (!player) return;

  delete connectingPlayers[tempId];
  connectingPlayers[source] = player;
  player.source = source;

  DEV: console.info(`Assigned id ${source} to OxPlayer<${player.userId}>`);
});

onNet('ox:playerJoined', async () => {
  const playerSrc = source;
  const player = connectingPlayers[playerSrc] || (await loadPlayer(playerSrc));
  delete connectingPlayers[playerSrc];

  if (!(player instanceof OxPlayer)) return DropPlayer(playerSrc.toString(), player || 'Failed to load player.');

  player.setAsJoined();
});

on('playerDropped', () => {
  const player = OxPlayer.get(source);

  if (!player) return;

  player.logout(true, true);
  OxPlayer.remove(player.source);

  DEV: console.info(`Dropped OxPlayer<${player.userId}>`);
});

RegisterCommand(
  'saveplayers',
  () => {
    OxPlayer.saveAll();
  },
  true,
);
