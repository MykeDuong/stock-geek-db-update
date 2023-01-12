FROM node:18-alpine
WORKDIR /Users/minhhongduong/Projects/stock-geek/stock-geek-update-worker
COPY . .
RUN yarn install --production
CMD ["yarn", "start"]
EXPOSE 3001