require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  Collection,
} = require("discord.js");
const sqlite3 = require("sqlite3").verbose();
const { TwitterApi, EUploadMimeType } = require("twitter-api-v2");
const FileType = require("file-type");
const { resolve } = require("node:path");

let db = new sqlite3.Database("./database.db");
db.run(`CREATE TABLE IF NOT EXISTS tweets (message_id TEXT)`);

const userClient = new TwitterApi({
  appKey: process.env.API_KEY,
  appSecret: process.env.SECRET_KEY,
  accessToken: process.env.ACCESS_TOKEN,
  accessSecret: process.env.ACCESS_SECRET,
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  // Set a new item in the Collection with the key as the command name and the value as the exported module
  if ("data" in command && "execute" in command) {
    client.commands.set(command.data.name, command);
  } else {
    console.log(
      `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`
    );
  }
}

client.once(Events.ClientReady, (c) => {
  console.log(`Ready! Logged in as ${c.user.tag}`);
});


client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = interaction.client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    await interaction.reply({
      content: "There was an error while executing this command!",
      ephemeral: true,
    });
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  // When a reaction is received, check if the structure is partial
  await reaction.fetch();

  let msgid = reaction.message.id;
  if (reaction.message.channelId === process.env.DISCORD_CHANNEL_ID) {
    let message = reaction.message.content;
    let author = reaction.message.author;
    let attachments = reaction.message.attachments;
    let count = reaction.count;

    try {
      const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
      if (count < 5) return;
      const rows = await new Promise((res, rej) => db.all(
        `SELECT EXISTS(SELECT 1 FROM tweets WHERE message_id=$id)`,
        { $id: msgid },
        (err, rows) => err ? rej() : res(rows)
      ));

      if (Object.values(rows[0])[0]) throw Error("Already posted!");

      let mediaIds = [];
      if (attachments.size > 4) {
        await channel.send(`4 or fewer images are permitted, ${author}.`)
        return;
      }

      for (let attachment of attachments) {
        const response = await fetch(attachment.url);
        const file = Buffer.from(await response.arrayBuffer());
        const mediaId = await userClient.v1.uploadMedia(file, {
          mimeType: attachment.contentType,
        });
        mediaIds.push(mediaId);
      }

      let tweet = {
        text: message,
      };

      if (mediaIds.length > 0) tweet["media"] = { media_ids: mediaIds };
      await userClient.v2.tweet(tweet);
      console.log("twote");

      db.run(
        `INSERT INTO tweets(message_id) VALUES(?)`,
        [msgid]
      );

      await channel.send(`Tweeted ${author}'s message: ${message}`);
    } catch (e) {
      console.log(`ERR: ${e}`);
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
