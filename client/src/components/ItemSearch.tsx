import {Card, Image, Text, Button, Group, TextInput} from '@mantine/core';
import {useState} from "react";
import {Item} from "../types/Item.ts";
import axios from 'axios';

export default function ItemSearch() {
	const [searchQuery, setSearchQuery] = useState('');
	const [searchResults, setSearchResults] = useState<Item>({} as Item);

	function searchItem() {
		const apiUrl = `/api/items/id/${searchQuery}`;

		axios.get(apiUrl)
			.then(response => {
				setSearchResults(response.data);
			})
			.catch(error => {
				console.error("Error fetching data:", error);
			});
	}

	return (
		<Card shadow="sm" p="lg">
			<Card.Section>
				<Image
					src="https://raw.githubusercontent.com/mantinedev/mantine/master/.demo/images/bg-8.png"
					height={160}
					alt="Norway"
				/>
			</Card.Section>

			<Group justify="space-between" mt="md" mb="xs">
				<Text size="sm">Search for an item</Text>
				<TextInput value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}/>
				<Button variant="light" color="blue" radius="md" onClick={searchItem}>
					Search
				</Button>
			</Group>

			<Text>
				{searchResults.id && searchResults.name}
			</Text>
		</Card>
	);
}