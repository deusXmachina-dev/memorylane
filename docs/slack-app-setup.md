# Slack App Setup

Use this when you want Memorylane to watch Slack channels and draft replies.

## Before You Start

- You need permission to install an app into your Slack workspace.
- You need Memorylane running locally.
- You need an OpenRouter key configured in Memorylane if you want semantic Slack replies. Without it, the Slack integration will start but skip reply generation. See [slack-semantic-layer.md](./slack-semantic-layer.md).

## 1. Create the Slack App

1. Open [api.slack.com/apps](https://api.slack.com/apps).
2. Click **Create New App**.
3. Choose **From manifest**.
4. Pick the Slack workspace you want to use.
5. Paste the contents of [slack-app-manifest.template.json](./slack-app-manifest.template.json).
6. Create the app.
7. Open **OAuth & Permissions** and click **Install to Workspace**.

After install, copy the **Bot User OAuth Token**. It should start with `xoxb-`.

## 2. Prepare Slack

1. Invite the bot to every channel you want Memorylane to watch.
2. Copy the channel IDs for those channels.
3. If you want manual approval, copy your Slack member ID too.

How to find IDs:

- Channel ID: open the channel, open the channel details, then copy the channel ID.
- Member ID: open your Slack profile, then copy your member ID.

## 3. Fill the Memorylane Settings

Open Memorylane settings and fill the Slack section like this:

- `Bot Token`: the `xoxb-...` bot token from Slack
- `Owner User ID`: your member ID. Required only when `Auto-approve replies` is off
- `Watched Channels`: comma-separated channel IDs such as `C0123456789, C9876543210`
- `Poll Interval (Seconds)`: start with `60`. Lower values are allowed, but are more likely to hit Slack API limits
- `Auto-approve replies`:
  - `On`: Memorylane posts the drafted reply immediately
  - `Off`: Memorylane sends you a DM and waits for `:+1:` to approve or `:-1:` to reject

Then click **Save Slack Settings** and turn the integration on.

## 4. Recommended Starting Setup

- Watch one channel first.
- Keep the poll interval at `60` seconds or higher.
- Use auto-approve off first if you want to verify the drafts.

Once that works, add more channels carefully.

## 5. Troubleshooting

- `Slack integration is enabled but incomplete`: one of bot token, watched channels, or owner user ID is missing.
- `not_in_channel`: the bot has not been invited to the watched channel.
- No replies are generated: verify Memorylane has an OpenRouter key and recent activity to search.
- Frequent Slack API errors: increase the poll interval and reduce the number of watched channels.

## Scope Reference

The manifest template includes only the scopes Memorylane currently uses:

- `channels:history`
- `groups:history`
- `im:history`
- `im:write`
- `chat:write`
