import './App.css'

import '@mantine/core/styles.css';

import {MantineProvider} from '@mantine/core';
import HomeInfo from "./components/HomeInfo.tsx";

function App() {

	return (
		<MantineProvider>
			<HomeInfo />
		</MantineProvider>
	)
}

export default App
