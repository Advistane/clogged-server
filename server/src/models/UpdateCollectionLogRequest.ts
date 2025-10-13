
interface CollectedItem {
	id: number; // Item ID
	quantity: number;
}

interface Subcategory {
	id: number;
	kc: number;
}

export interface UserCollectionData {
	username: string;
	accountHash: number;
	gameMode: string;
	profileVisible: boolean;
	collectedItems: CollectedItem[];
	subcategories: Subcategory[];
}