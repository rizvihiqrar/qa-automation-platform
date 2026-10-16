export const characters = [
  { id: '1',  name: 'Rick Sanchez',     status: 'Alive',   species: 'Human',    type: '',      gender: 'Male',   originId: '1', locationId: '20' },
  { id: '2',  name: 'Morty Smith',      status: 'Alive',   species: 'Human',    type: '',      gender: 'Male',   originId: '1', locationId: '20' },
  { id: '3',  name: 'Summer Smith',     status: 'Alive',   species: 'Human',    type: '',      gender: 'Female', originId: '20', locationId: '20' },
  { id: '4',  name: 'Beth Smith',       status: 'Alive',   species: 'Human',    type: '',      gender: 'Female', originId: '1', locationId: '20' },
  { id: '5',  name: 'Jerry Smith',      status: 'Alive',   species: 'Human',    type: '',      gender: 'Male',   originId: '1', locationId: '20' },
  { id: '6',  name: 'Abadango Cluster', status: 'Alive',   species: 'Alien',    type: '',      gender: 'Male',   originId: '2', locationId: '2'  },
  { id: '7',  name: 'Abradolf Lincler', status: 'unknown', species: 'Human',    type: 'Genetic experiment', gender: 'Male', originId: '1', locationId: '3' },
  { id: '8',  name: 'Adjudicator Rick', status: 'Dead',    species: 'Human',    type: '',      gender: 'Male',   originId: null, locationId: '3' },
  { id: '9',  name: 'Agency Director',  status: 'Dead',    species: 'Human',    type: '',      gender: 'Male',   originId: '1', locationId: '1'  },
  { id: '10', name: 'Alan Rails',       status: 'Dead',    species: 'Human',    type: 'Superhuman', gender: 'Male', originId: '1', locationId: '1' },
  { id: '11', name: 'Albert Einstein',  status: 'Dead',    species: 'Human',    type: '',      gender: 'Male',   originId: '1', locationId: '1'  },
  { id: '12', name: 'Alexander',        status: 'Dead',    species: 'Human',    type: '',      gender: 'Male',   originId: '1', locationId: '1'  },
  { id: '13', name: 'Alien Googah',     status: 'Dead',    species: 'Alien',    type: '',      gender: 'unknown', originId: null, locationId: '1' },
  { id: '14', name: 'Alien Morty',      status: 'unknown', species: 'Alien',    type: '',      gender: 'Male',   originId: null, locationId: null },
  { id: '15', name: 'Alien Rick',       status: 'unknown', species: 'Alien',    type: '',      gender: 'Male',   originId: null, locationId: null },
  { id: '16', name: 'Amish Cyborg',     status: 'Dead',    species: 'Human',    type: 'Cyborg', gender: 'Male',  originId: '1', locationId: '1'  },
  { id: '17', name: 'Annie',            status: 'Alive',   species: 'Human',    type: '',      gender: 'Female', originId: '1', locationId: '1'  },
  { id: '18', name: 'Antenna Morty',    status: 'Alive',   species: 'Human',    type: 'Human with antenna', gender: 'Male', originId: null, locationId: '3' },
  { id: '19', name: 'Antenna Rick',     status: 'unknown', species: 'Human',    type: 'Human with antenna', gender: 'Male', originId: null, locationId: null },
  { id: '20', name: 'Ants in my Eyes Johnson', status: 'unknown', species: 'Human', type: '', gender: 'Male', originId: null, locationId: null },
  { id: '21', name: 'Bepisian',         status: 'Alive',   species: 'Alien',    type: '',      gender: 'unknown', originId: '2', locationId: '2' },
  { id: '22', name: 'Bird Person',      status: 'Alive',   species: 'Alien',    type: 'Bird-Person', gender: 'Male', originId: '2', locationId: '2' },
  { id: '23', name: 'Birdperson',       status: 'Dead',    species: 'Humanoid', type: 'Birdperson', gender: 'Male', originId: '2', locationId: '2' },
  { id: '24', name: 'Box Morty',        status: 'Alive',   species: 'Human',    type: 'Morty in a box', gender: 'Male', originId: null, locationId: '3' },
  { id: '25', name: 'Butter Robot',     status: 'Alive',   species: 'Robot',    type: '',      gender: 'unknown', originId: '1', locationId: '1' },
];

export const locations = [
  { id: '1',  name: 'Earth (C-137)',       type: 'Planet',    dimension: 'Dimension C-137',   residentIds: ['1','4','5','9','10','11','12','13','16','17'] },
  { id: '2',  name: 'Abadango',            type: 'Cluster',   dimension: 'unknown',            residentIds: ['6','21','22','23'] },
  { id: '3',  name: 'Citadel of Ricks',   type: 'Space station', dimension: 'unknown',        residentIds: ['7','8','18','19','24'] },
  { id: '20', name: 'Earth (Replacement Dimension)', type: 'Planet', dimension: 'Replacement Dimension', residentIds: ['2','3'] },
];

export const episodes = [
  { id: '1', name: 'Pilot',                  air_date: 'December 2, 2013',    episode: 'S01E01', characterIds: ['1','2','3','4','5'] },
  { id: '2', name: 'Lawnmower Dog',          air_date: 'December 9, 2013',    episode: 'S01E02', characterIds: ['1','2','9','10'] },
  { id: '3', name: "Anatomy Park",           air_date: 'December 16, 2013',   episode: 'S01E03', characterIds: ['1','2','3','17'] },
  { id: '4', name: 'M. Night Shaym-Aliens!', air_date: 'January 13, 2014',    episode: 'S01E04', characterIds: ['1','2','9','13'] },
  { id: '5', name: 'Meeseeks and Destroy',   air_date: 'January 20, 2014',    episode: 'S01E05', characterIds: ['1','2','3','4','5'] },
];
