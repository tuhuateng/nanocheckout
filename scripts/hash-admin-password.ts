import { hashAdminPassword } from '../src/runtime/admin-auth';

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run admin:hash -- "your-long-password"');
  process.exit(1);
}

console.log(await hashAdminPassword(password));
