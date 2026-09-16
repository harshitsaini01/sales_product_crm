import { prisma } from './src/lib/prisma';

async function main() {
  const loginid = 'hallyjensiyadhivakar@gmail.com';
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ loginid }, { email: loginid }, { username: loginid }, { mobile: loginid }],
    },
    include: { roles: true },
  });

  if (user) {
    console.log('User found:');
    console.log(JSON.stringify({
      id: user.id.toString(),
      email: user.email,
      role: user.role,
      status: user.status,
      roles: user.roles.map(r => r.role)
    }, null, 2));
  } else {
    console.log('User NOT found');
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
