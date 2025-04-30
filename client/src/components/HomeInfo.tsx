import {Button, Card, Group, Image, Text} from "@mantine/core";
import {IconBrandGithub, IconBrandDiscord} from '@tabler/icons-react';
export default function HomeInfo() {
	return (
		<div>
			<Card shadow="sm" p="lg">
				<Card.Section>
					<Image
						src="/home.png"
						height={640}
					/>
					<Text size="sm">The website is a work in progress...but you can use the Runelite plugin</Text>

					<Group justify="center" mt="md" mb="xs">
						<Button
							leftSection={<IconBrandGithub size={32} stroke={1.5} color="black" />}
							component="a"
							href="https://github.com/Advistane/clogged"
							target ="_blank"
						>
							Plugin Source
						</Button>

						<Button
							leftSection={<IconBrandGithub size={32} stroke={1.5} color="black" />}
							component="a"
							href="https://github.com/Advistane/clogged-server"
							target ="_blank"
						>
							Server Source
						</Button>

						<Button
							leftSection={<IconBrandDiscord size={32} stroke={1.5} color="black" />}
							component="a"
							href="https://discord.gg/jVqBpUKBJb"
							target ="_blank"
						>
							Clogged.me Discord
						</Button>
					</Group>
				</Card.Section>
			</Card>
		</div>
	)
}