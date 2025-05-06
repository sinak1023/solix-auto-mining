# Telegram Bot for SolixDepin Automation

This is a Node.js-based Telegram bot designed to automate tasks on the SolixDepin platform, including account registration, task execution, and mining operations. The bot interacts with the SolixDepin API, handles proxies, and solves captchas to streamline operations.

## Features

- **Account Management**: Add, list, and delete accounts stored in `accounts.json`.
- **Registration**: Automate account registration with captcha solving using a third-party API.
- **Task Automation**: Perform and claim tasks for registered accounts to earn points.
- **Mining**: Continuously monitor account points with periodic updates via Telegram.
- **Proxy Support**: Use proxies for API requests to enhance anonymity and avoid rate limits.
- **Admin-Only Access**: Restrict bot usage to a specified Telegram admin ID.
- **Error Handling**: Robust handling of Telegram errors (e.g., user blocking bot) and API failures.

## Prerequisites

- **Node.js**: Version 22.12.0 or higher.
- **Telegram Bot Token**: Obtain from [BotFather](https://t.me/BotFather).
- **Captcha Solving API Key**: From a service like [SCTG](https://t.me/Xevil_check_bot).
- **Proxy List**: Optional, for enhanced request routing.

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/sinak1023/solix-auto-mining.git
   cd solix-auto-mining
   ```

2. Install dependencies:
   ```bash
   npm install telegraf axios https-proxy-agent uuid
   ```

3. Create required files:
   - `accounts.json`: Initialize with an empty array `[]` to store account details.
   - `proxy.txt`: Add proxy addresses (one per line, format: `http://user:pass@host:port` or `http://host:port`).
   - `apikey.txt`: Add your captcha solving API key.

4. Configure the bot:
   - Open `index.js` and update the `ADMIN_ID` with your Telegram user ID.
   - Replace the bot token in `index.js` with your Telegram bot token.

## Usage

1. Run the bot:
   ```bash
   node index.js
   ```

2. Interact via Telegram:
   - Start the bot with `/start` to access the main menu.
   - Use inline buttons to manage accounts, set API keys, perform tasks, register new accounts, or start/stop mining.
   - Only the admin (specified by `ADMIN_ID`) can use the bot.

## File Structure

- `index.js`: Main bot script.
- `accounts.json`: Stores account credentials and associated proxies.
- `proxy.txt`: List of proxies for API requests.
- `apikey.txt`: Captcha solving API key.
- `LICENSE`: MIT License file.

## Error Handling

The bot includes robust error handling for:
- Telegram API errors (e.g., `403: Forbidden` when blocked by users).
- SolixDepin API failures with retry logic.
- Proxy validation and fallback.
- Captcha solving issues with retry attempts.

## Contributing

Contributions are welcome! Please:
1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/your-feature`).
3. Commit your changes (`git commit -m 'Add your feature'`).
4. Push to the branch (`git push origin feature/your-feature`).
5. Open a pull request.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Disclaimer

This bot is for educational purposes only. Ensure compliance with SolixDepin's terms of service and Telegram's API usage policies. The author is not responsible for any misuse or consequences of using this bot.
