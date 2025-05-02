interface Subcategory {
	id: number;
	name: string;
	items: number[];
	categoryId: number;
}

// Interface for the categories object (mapping name to ID)
interface Categories {
	name: string;
	id: number;
}

// Interface for the entire request body
export interface StaticDataRequest {
	subcategories: Subcategory[];
	categories: Categories[];
}