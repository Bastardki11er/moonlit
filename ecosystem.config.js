module.exports = {
  apps: [
    {
      name: "moonlit",
      script: "backend/server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      max_memory_restart: "512M",
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      time: true,
    },
  ],
};
