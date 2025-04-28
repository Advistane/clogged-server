import {Button, Card, Group, Image, Text} from "@mantine/core";
import {IconBrandGithub} from '@tabler/icons-react';
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
							component="a"
							href="https://github.com/Advistane/clogged"
							target ="_blank"
						>
							<IconBrandGithub size={32} stroke={1.5} color="black" />
							Plugin Source
						</Button>

						<Button
							component="a"
							href="https://github.com/Advistane/clogged-server"
							target ="_blank"
						>
							<IconBrandGithub size={32} stroke={1.5} color="black" />
							Server Source
						</Button>
					</Group>
				</Card.Section>
			</Card>
		</div>
	)
}