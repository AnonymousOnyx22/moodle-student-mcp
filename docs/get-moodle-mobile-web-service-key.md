# How to get your Moodle mobile web service key

This server needs one key from your own Moodle account. The key lets Moodle know the server is acting for you, and it is the value you put in `MOODLE_TOKEN` in the install line for your app.

## Before you start

- The address of your school's Moodle site, such as `https://moodle.yourschool.edu`. Put this in `MOODLE_BASE_URL`.
- A browser where you are already signed in to that Moodle site.
- The mobile web service turned on for your school. Your school controls this setting.

## Steps

1. Open your school's Moodle site in a browser and sign in.
2. Open your profile menu. It is usually your name or picture at the top of the page.
3. Choose **Preferences**.
4. Under **User account**, choose **Security keys**.
5. Find the key named **Moodle mobile web service** and copy the whole key. It is a long string of letters and numbers.
6. Put the key in `MOODLE_TOKEN` and put your Moodle address in `MOODLE_BASE_URL`. Use the address you see in the browser, without a page path at the end.
7. Check the setup with `npx moodle-student-mcp doctor`. When both values are right, it prints a line like `Connected to Your School as Your Name.`

The key belongs to your account. Anyone who has it can read your Moodle courses, so keep it out of screenshots, chats and public repositories.

## If there is no Moodle mobile web service key

- **The Security keys page is missing, or the page has no Moodle mobile web service key.** Your school has turned off the mobile web service for students. Ask your school's IT help desk to turn it on. This server cannot connect to your account without it.
- **You sign in through single sign on and the page gives you no key.** Some schools do not give students a key. If there is no key to copy, this server cannot connect to your account.
- **A tool says "Not signed in".** The key was reset or has expired. Copy the current key from **Preferences > User account > Security keys** and update `MOODLE_TOKEN`.
- **A tool says "Access denied".** Your school may have turned a feature off for students. Also check that you copied the Moodle mobile web service key, not a key for another service. The name is on the Security keys page next to the key.
- **A tool says "Web services not enabled".** Your school has not turned on the mobile web service, so there is no Moodle mobile web service key to copy. Ask your school to turn it on.

## Keeping the key safe

- The key is only sent to the Moodle address in `MOODLE_BASE_URL`. This project does not send it to any other server.
- `get_file` only downloads a link on your school's Moodle site. A link that points somewhere else is refused, so a link in a course page or an announcement cannot take your key.
- You can reset the key at any time on the Security keys page. After a reset, the old key stops working and you need to update `MOODLE_TOKEN` in your app config.

## Back to setup

Return to the [Quick start in the README](https://github.com/AnonymousOnyx22/moodle-student-mcp#quick-start) and finish the install for your app.
